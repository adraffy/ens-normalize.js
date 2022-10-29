import {mkdirSync, writeFileSync, createWriteStream, existsSync} from 'node:fs';
import {compare_arrays, explode_cp, parse_cp_sequence} from './utils.js';
import {UNICODE, NF, IDNA, SCRIPTS} from './unicode-version.js';
import {AUGMENTED_ALL} from './unicode-logic.js';
import CHARS_VALID from './rules/chars-valid.js';
import CHARS_DISALLOWED from './rules/chars-disallow.js';
import CHARS_MAPPED from './rules/chars-mapped.js';
import CHARS_ESCAPE from './rules/chars-escape.js';
import {CM_DISALLOWED, CM_WHITELIST} from './rules/cm.js';
import {ORDERED_SCRIPTS, RESTRICTED_SCRIPTS, CHANGED_SCRIPTS} from './rules/scripts.js';

const Zinh = SCRIPTS.require('Zinh');

let out_dir = new URL('./output/', import.meta.url);

// quick hack to capture log
((stream) => {
	let out = createWriteStream(new URL('./log.txt', out_dir).pathname);
	let old = stream.write.bind(stream);
	stream.write = function(...a) {
		old(...a);
		out.write(...a);
	};
})(process.stdout);

// quick idiot check
function assert_distinct(things) {
	let m = Object.entries(things).map(([k, v]) => [k, new Set(v)]);
	for (let i = 0; i < m.length; i++) {
		let set_i = m[i][1];
		for (let j = i + 1; j < m.length; j++) {
			let set_j = m[j][1];
			for (let x of set_i) {
				if (set_j.has(x)) {
					console.log(m[i][0], m[j][0], x);
					throw new Error('distinct');
				}
			}
		}
	}
}
assert_distinct({
	CHARS_VALID, 
	CHARS_DISALLOWED, 
	MAPPED: CHARS_MAPPED.map(x => x[0])
});

// TODO: this is shitty improve this
let ordered_scripts = [...new Set(ORDERED_SCRIPTS.flatMap(x => x.test))];
let unordered_scripts = new Set(SCRIPTS.entries.map(x => x.abbr));
ordered_scripts.forEach(x => unordered_scripts.delete(x));
for (let abbr of RESTRICTED_SCRIPTS) {
	if (!unordered_scripts.delete(abbr)) {
		throw new Error(`Restricted duplicate: ${abbr}`);
	}
}
unordered_scripts.delete('Zyyy');
unordered_scripts.delete('Zinh');
if (unordered_scripts.size) {
	console.log(unordered_scripts);
	throw new Error('unordered');
}

console.log(`Build Date: ${new Date().toJSON()}`);
console.log(`Unicode Version: ${UNICODE.version_str}`);

// these are our primary output structures
let ignored = new Set(IDNA.ignored);
let valid = new Set(IDNA.valid);
let mapped = new Map(IDNA.mapped);
let escaped = new Set(CHARS_ESCAPE);
//let isolated = new Set();
let emoji = new Map();

function disallow_char(cp, quiet) {	
	let replacement = mapped.get(cp);
	if (replacement) {
		mapped.delete(cp);
		console.log(`Removed Mapped: ${UNICODE.format(cp, replacement)}`);
	} else if (ignored.delete(cp)) {
		console.log(`Removed Ignored: ${UNICODE.format(cp)}`);
	} else if (valid.delete(cp)) {
		let print = () => {
			console.log(`Removed Valid: ${UNICODE.format(cp)}`);
			print = false;
		};
		if (!quiet) print();
		for (let [x, ys] of mapped) {
			if (ys.includes(cp)) {
				if (print) print();
				mapped.delete(x);
				console.log(`--Mapping: ${UNICODE.format(x, ys)}`);
			}
		}
	}
}

function register_emoji(info) {
	try {
		let {cps} = info;
		if (!Array.isArray(cps) || !cps.length) throw new Error('expected cps');
		if (!info.name) throw new Error('expected name');
		if (!info.type) throw new Error('expected type');
		info.name = info.name.replace(/\\x{([0-9a-f]{2})}/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
		let key = String.fromCodePoint(...cps);
		let old = emoji.get(key);
		if (old) {
			console.log(old);
			throw new Error(`duplicate`);
		}
		console.log(`Register Emoji [${info.type}]: ${UNICODE.format(info)}`);		
		emoji.set(key, info);
	} catch (err) {
		console.log(info);
		throw new Error(`Register Emoji: ${err.message}`);
	}
}

/*
function set_isolated(cp) {
	if (isolated.has(cp)) {
		throw new Error(`Already Isolated: ${UNICODE.format(cp)}`);
	}
	isolated.add(cp);
	console.log(`Isolated: ${UNICODE.format(cp)}`);
}
*/

let emoji_zwjs = UNICODE.emoji_zwjs();
emoji_zwjs.RGI_Emoji_ZWJ_Sequence.forEach(register_emoji);

let emoji_seqs = UNICODE.emoji_seqs();
emoji_seqs.Emoji_Keycap_Sequence.forEach(register_emoji);
emoji_seqs.RGI_Emoji_Tag_Sequence.forEach(register_emoji);
emoji_seqs.RGI_Emoji_Modifier_Sequence.forEach(register_emoji);

// derive flag sequences with valid regions
// warning: this contains EZ and QO
// UNICODE.valid_emoji_flag_sequences().forEach(register_emoji);
// use the following instead
emoji_seqs.RGI_Emoji_Flag_Sequence.forEach(register_emoji);

let emoji_disabled = [];

let emoji_chrs = UNICODE.emoji_data();
let emoji_map = new Map(emoji_chrs.Emoji.map(x => [x.cp, x]));

// names suck: old, ucd, emoji (incomplete)
/*
// modernize names
for (let info of emoji_seqs.Basic_Emoji) {
	let rec = emoji_map.get(info.cps[0]);
	if (!rec) throw new Error(`Expected emoji: ${UNICODE.format(info)}`);
	if (rec.name.localeCompare(info.name, 'en', {sensitivity: 'base'})) {
		rec.name = `${rec.name} (${info.name})`;
	}
}
*/

// demote mapped emoji
let emoji_demoted = new Set((await import('./rules/emoji-demoted.js')).default);
for (let rec of emoji_map.values()) {
	if (emoji_demoted.has(rec.cp)) {
		rec.used = true;
		emoji_disabled.push(rec);
		console.log(`Demoted Emoji: ${UNICODE.format(rec)}`);
	} else {
		disallow_char(rec.cp, true); // quiet because there are a lot of these
	}
}

// disable single regionals
for (let cp of UNICODE.regional_indicators()) {
	let rec = emoji_map.get(cp);
	rec.used = true;
	emoji_disabled.push(rec);
	console.log(`Disabled Emoji: ${rec}`);
}

// disable skin modifiers
for (let info of UNICODE.emoji_skin_colors()) {
	emoji_map.get(info.cp).used = true;
	emoji_disabled.push(info);
	console.log(`Disabled Emoji: ${info}`);
}

// disable hair modifiers
// 20221004: these don't seem to function the same as skin
/* 
for (let info of UNICODE.emoji_hair_colors()) {
	emoji_map.get(info.cp).used = true;
	emoji_disabled.push(info);
	console.log(`Disabled Emoji: ${info}`);
}
*/

// register forced FE0F
for (let info of emoji_seqs.Basic_Emoji) {
	if (info.cps.length == 2 && info.cps[1] == 0xFE0F) { // X + FE0F
		let rec = emoji_map.get(info.cps[0]);
		if (!rec) throw new Error(`Expected emoji: ${UNICODE.format(info)}`);	
		if (rec.used) continue;
		rec.used = true;
		register_emoji(info);
	}
}

// register default emoji-presentation
for (let info of emoji_chrs.Emoji_Presentation) {
	let rec = emoji_map.get(info.cp);
	if (!rec) throw new Error(`Expected emoji: ${UNICODE.format(info)}`);	
	if (rec.used) continue;
	rec.used = true;
	register_emoji({cps: [info.cp, 0xFE0F], ...info});
}

// register default text-presentation (leftovers)
for (let info of emoji_map.values()) {
	if (!info.used) {	
		register_emoji({cps: [info.cp], ...info});
	}
}

for (let info of (await import('./rules/emoji-seq-whitelist.js')).default) {
	register_emoji({cps: parse_cp_sequence(info.hex), type: 'Whitelisted', name: info.name});
}
for (let seq of (await import('./rules/emoji-seq-blacklist.js')).default) {
	let cps = parse_cp_sequence(seq);
	let key = String.fromCodePoint(...cps);
	let info = emoji.get(key);
	if (!info) {
		console.log(`*** Blacklist Emoji: No match for ${UNICODE.format(cps)}`); // should this be fatal? (yes)
		throw new Error('blacklist');
	}
	console.log(`Blacklist Emoji by Sequence: ${UNICODE.format(info)}`);
	emoji_disabled.push(info);
	emoji.delete(key);
}
for (let [x, ys] of CHARS_MAPPED) {
	let old = mapped.get(x);
	if (old && compare_arrays(old, ys) == 0) {
		throw new Error(`Already mapped: ${UNICODE.format(x, ys)}`);
	}
	disallow_char(x);
	mapped.set(x, ys);
	console.log(`Added Mapped: ${UNICODE.format(x, ys)}`);
}
for (let cp of CHARS_DISALLOWED) {
	if (!mapped.has(cp) && !ignored.has(cp) && !valid.has(cp)) {
		//throw new Error(`Already disallowed: ${UNICODE.format(cp)}`);
		console.log(`*** Already disallowed: ${UNICODE.format(cp)}`);
		//await new Promise(f => setTimeout(f, 500));
	}
	disallow_char(cp);
}
for (let cp of CHARS_VALID) {
	if (valid.has(cp)) throw new Error(`Already valid: ${UNICODE.format(cp)}`);
	disallow_char(cp);
	valid.add(cp);
	console.log(`Added Valid: ${UNICODE.format(cp)}`);
}
/*
for (let cp of (await import('./rules/chars-isolated.js')).default) {
	set_isolated(cp);
}
for (let info of emoji_chrs.Extended_Pictographic) { 
	if (!emoji_map.has(info.cp) && valid.has(info.cp)) {
		set_isolated(info.cp);
	}
}
*/

// apply script changes
SCRIPTS.apply_changes(CHANGED_SCRIPTS);

// compute characters that decompose to CM
let cm_base = new Map();
for (let {cp} of UNICODE.chars) {
	if (UNICODE.cm.has(cp)) continue;
	let [base_cp, ...cps] = NF.nfd([cp]);
	if (base_cp === cp) continue;
	if (!cps.every(x => UNICODE.cm.has(x))) continue;
	let bucket = cm_base.get(base_cp);
	if (!bucket) {
		bucket = [];
		cm_base.set(base_cp, bucket);
	}
	bucket.push(cp);
}
let cm_internal = new Set([...cm_base.values()].flat());

console.log(`Applying CM whitelist...`);
let cm_whitelist = new Map();
for (let form of CM_WHITELIST) {
	let [base_cp, ...cms] = NF.nfd(explode_cp(form));
	if (!valid.has(base_cp)) {
		throw new Error(`Restricted CM "${form}" Not Valid Base: ${UNICODE.format(base_cp)}`);
	}
	if (!cms.length) {
		throw new Error(`Restricted CM "${form}" Expected CM`);
	}
	for (let cp of cms) {
		if (!UNICODE.cm.has(cp)) {
			throw new Error(`Restricted CM "${form}" Not CM: ${UNICODE.format(cp)}`);
		}
		if (!valid.has(cp)) {
			throw new Error(`Restricted CM "${form}" Not Valid CM: ${UNICODE.format(cp)}`);
		}
	}
	let bucket = cm_whitelist.get(base_cp);
	if (!bucket) {
		bucket = [];
		cm_whitelist.set(base_cp, bucket);
	}
	if (bucket.some(v => compare_arrays(v, cms) == 0)) {
		throw new Error(`Restricted CM "${form}" Duplicate`);
	}
	bucket.push(cms);
	let [combo_cp] = NF.nfc([base_cp, ...cms]);
	cm_internal.delete(combo_cp);
	if (!valid.has(combo_cp)) {
		disallow_char(combo_cp);
		valid.add(combo_cp);
		console.log(`Restricted CM Valid: ${UNICODE.format(combo_cp)}`);
	}
}
console.log(`CM Whitelist: ${cm_whitelist.size}`);

// filter scripts
for (let script of SCRIPTS.entries) {
	script.valid = new Set([...script.set].filter(cp => valid.has(cp)));
}

// for every character thats in an isolated script but not cm-whitelisted,
// it's disallowed if it internally contains a CM (should of been whitelisted)
// everything else is considered isolated
console.log('Purging isolated...');
let cm_isolated = new Set();
for (let abbr of CM_DISALLOWED) {
	let script = SCRIPTS.require(abbr);
	for (let cp of script.valid) {
		if (cm_whitelist.has(cp)) continue;
		if (cm_internal.has(cp)) {
			script.valid.delete(cp);
			disallow_char(cp);
		} else {
			cm_isolated.add(cp);
		}
	}
}
console.log(`CM Isolated: ${cm_isolated.size}`)

// remove dangling mappings
for (let [x, ys] of mapped) {
	let cps = NF.nfd(ys);
	next: for (let i = 0; i < cps.length; i++) {
		if (!UNICODE.cm.has(cps[i+1])) continue;
		if (cm_isolated.has(cps[i])) {
			disallow_char(x);
		} else {
			let bucket = cm_whitelist.get(cps[i]);
			if (bucket) {
				for (let cms of bucket) {
					if (!compare_arrays(cps.slice(i+1, i+1+cms.length), cms)) {
						continue next; // found a match
					}
				}
				disallow_char(x); 
			}
		}
	}
}

// load restricted scripts
// require existance, remove empty
let restricted = [...new Set(RESTRICTED_SCRIPTS)].map(abbr => SCRIPTS.require(abbr)).filter(x => x.valid.size).sort();
// require decomposed sanity
for (let script of restricted) {	
	let set = new Set(NF.nfd([...script.valid])); // this is a good idea IMO
	for (let cp of set) {
		if (!script.valid.has(cp) && !Zinh.set.has(cp)) {
			throw new Error(`Restricted script ${script.abbr} decomposition: ${UNICODE.format(cp)}`);
		}
	}
	script.restricted = set;
}
// remove unrestricted from restricted
let unrestricted_union = new Set(SCRIPTS.entries.flatMap(x => x.restricted ? [] : NF.nfd([...x.valid]))); // see above
for (let script of restricted) {
	for (let cp of unrestricted_union) {
		script.restricted.delete(cp);
	}
}
restricted = restricted.filter(x => x.restricted.size); // remove empty
for (let script of restricted) {
	console.log(`Restricted [${script.abbr}]: All(${script.set.size}) Valid(${script.valid.size}) Restricted(${script.restricted.size})`);
}

async function read_wholes(file) {
	if (!existsSync(file)) return []; // uhhh
	return (await import(file)).default; 
}

// since restricted scripts cant intersect
// all the wholes can be unioned together
let restricted_wholes = new Set();
for (let script of restricted) {
	let wholes = await read_wholes(new URL(`./rules/restricted-wholes/${script.abbr}.js`, import.meta.url));	
	for (let cp of wholes) {
		if (script.valid.has(cp)) {
			restricted_wholes.add(cp);
		}
	}
}
console.log(`Restricted Wholes: ${restricted_wholes.size}`);

// ordered
let scripts = [];
function register_ordered(name, set) {
	let rec = scripts.find(x => x.name === name);
	if (!rec) {
		if (!set) set = SCRIPTS.require(name).valid;
		rec = {name, set, index: scripts.length};
		scripts.push(rec);
	}
	return rec;
}
// ALL must go first
register_ordered(AUGMENTED_ALL, new Set(['Zinh', 'Zyyy'].flatMap(abbr => [...SCRIPTS.require(abbr).valid])));
let ordered = await Promise.all(ORDERED_SCRIPTS.map(async ({name, test, rest, allow = [], deny = []}) => {
	test = test.map(abbr => register_ordered(abbr));
	rest = rest.map(abbr => register_ordered(abbr));
	for (let cp of [allow, deny].flat()) {
		if (!valid.has(cp)) {
			throw new Error(`Expected ordered ${name} valid: ${UNICODE.format(cp)}`);
		}
	}
	let union = new Set([[test, rest].flat().flatMap(x => [...x.set]), allow].flat());
	let wholes = (await read_wholes(new URL(`./rules/ordered-wholes/${name}.js`, import.meta.url))).filter(cp => union.has(cp));
	console.log(`Ordered: ${name} Test(${test.map(x => x.name)}) Rest(${rest.map(x => x.name)}) Allow(${allow.length}) Deny(${deny.length}) Wholes(${wholes.length})`);
	// convert to indices
	test = test.map(x => x.index);
	rest = rest.map(x => x.index);
	return {name, test, rest, allow, deny, wholes};
}));


// check that everything makes sense
/*
function has_adjacent_cm(cps) {
	for (let i = 1; i < cps.length; i++) {
		if (UNICODE.cm.has(cps[i]) && UNICODE.cm.has(cps[i-1])) {
			return true;
		}
	}
}
for (let cp of valid) {
	let decomposed = NF.nfd([cp]);
	if (has_adjacent_cm(decomposed)) {
		throw new Error(`Adjacent CM in Valid: ${UNICODE.format(cp, decomposed)}`);
	}
}
*/
for (let cp of ignored) {
	if (valid.has(cp)) {
		throw new Error(`Ignored is valid: ${UNICODE.format(cp)}`);
	} else if (mapped.has(cp)) {
		throw new Error(`Ignored is mapped: ${UNICODE.format(cp)}`);
	}
}
for (let [x, ys] of mapped.entries()) {
	if (valid.has(x)) {
		throw new Error(`Mapped is valid: ${UNICODE.format(x)}`);
	}
	if (!ys.every(cp => valid.has(cp))) { // not valid chars
		if (!ys.every(cp => emoji_map.has(cp))) { // not multiple single emoji
			throw new Error(`Mapping isn't valid or emoji: ${UNICODE.format(x, ys)}`);
		}
	}
	/*
	let decomposed = NF.nfd(ys);
	if (has_adjacent_cm(decomposed)) {
		throw new Error(`Adjacent CM in Mapping: ${UNICODE.format(x, ys, decomposed)}`);
	}
	*/
	if (ys.includes(0x2E)) {
		throw new Error(`Mapping includes Stop: ${UNICODE.format(x, ys)}`);
	}
}
let cc = new Set(UNICODE.chars.filter(x => x.cc > 0).map(x => x.cp)); 
for (let info of emoji.values()) {
	let {cps} = info;
	if (cc.has(cps[0]) || cc.has(cps[cps.length-1])) {
		console.log(info);
		throw new Error(`Emoji with non-zero combining class boundary: ${UNICODE.format(info)}`);
	}
}
for (let cp of Zinh.valid) {
	if (UNICODE.cm.has(cp)) continue;
	throw new Error(`Inherited Script isn't only CM: ${UNICODE.format(cp)}`);
}
for (let cp of escaped) {
	if (valid.has(cp)) {
		throw new Error(`Escaped character is valid: ${UNICODE.format(cp)}`);
	}
}

// make every disabled emoji a solo-sequence (not critical)
for (let info of emoji_disabled) {
	if (!info.cps) info.cps = [info.cp];
	info.type = 'Disabled';
}

function sorted(v) {
	return [...v].sort((a, b) => a - b);
}

// note: sorting isn't important, just nice to have
const created = new Date();
mkdirSync(out_dir, {recursive: true});
writeFileSync(new URL('./spec.json', out_dir), JSON.stringify({
	created,
	unicode: UNICODE.version_str,
	valid: sorted(valid),
	ignored: sorted(ignored),
	mapped: [...mapped.entries()].sort((a, b) => a[0] - b[0]),
	cm: sorted([...UNICODE.cm].filter(cp => valid.has(cp))),
	cm_isolated: sorted(cm_isolated),
	cm_whitelist: [...cm_whitelist.entries()],
	emoji: [...emoji.values()].map(x => x.cps).sort(compare_arrays),
	script_names: Object.fromEntries(SCRIPTS.entries.map(x => [x.abbr, x.name])),
	scripts: scripts.map(x => [x.name, sorted(x.set)]),
	ordered: ordered.map(x => {
		x.wholes = sorted(x.wholes);
		x.test = sorted(x.test);
		x.rest = sorted(x.rest);
		return x;
	}),
	restricted: Object.fromEntries(restricted.map(x => [x.abbr, sorted(x.restricted)])),	
	restricted_wholes: sorted(restricted_wholes),
	escape: sorted(escaped),
	cm_invalid: sorted([...UNICODE.cm].filter(cp => !valid.has(cp) && !escaped.has(cp)))
}));

// this file should be independent so we can create a standalone nf implementation
writeFileSync(new URL('./nf.json', out_dir), JSON.stringify({
	created,
	unicode: UNICODE.version_str,
	ranks: UNICODE.combining_ranks(),
	exclusions: UNICODE.composition_exclusions(),
	decomp: UNICODE.decompositions(),
	qc: sorted(UNICODE.nf_props().NFC_QC.map(x => x[0]))
}));
writeFileSync(new URL('./nf-tests.json', out_dir), JSON.stringify(UNICODE.nf_tests()));

// conveniences files (not critical)
// for emoji.html
writeFileSync(new URL('./emoji-info.json', out_dir), JSON.stringify([...emoji.values(), ...emoji_disabled].map(info => {
	let {cps, name, version, type} = info;
	return {form: String.fromCodePoint(...cps), name, version, type};
})));

// for chars.html
writeFileSync(new URL('./names.json', out_dir), JSON.stringify(UNICODE.chars.map(info => {
	let name = UNICODE.get_name(info.cp);
	if (!name) return [];
	return [info.cp, name];
}).filter(x => x)));
writeFileSync(new URL('./scripts.json', out_dir), JSON.stringify(SCRIPTS.entries.map(info => {
	let {name, abbr, set} = info;
	set = [...set];
	return {name, abbr, set};
})));
