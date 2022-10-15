import {mkdirSync, writeFileSync, createWriteStream} from 'node:fs';
import {compare_arrays, parse_cp_sequence} from './utils.js';
import {UNICODE, NF, IDNA, SCRIPTS, SCRIPT_ORDER} from './unicode-version.js';
import {read_wholes} from './wholes.js';

import CHARS_VALID from './rules/chars-valid.js';
import CHARS_DISALLOWED from './rules/chars-disallow.js';
import CHARS_MAPPED from './rules/chars-mapped.js';

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


console.log(`Build Date: ${new Date().toJSON()}`);
console.log(`Unicode Version: ${UNICODE.version_str}`);

// these are our primary output structures
let ignored = new Set(IDNA.ignored);
let valid = new Set(IDNA.valid);
let mapped = new Map(IDNA.mapped);
let isolated = new Set();
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
		if (!quiet)print();
		if (!quiet) 
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

function set_isolated(cp) {
	if (isolated.has(cp)) {
		throw new Error(`Already Isolated: ${UNICODE.format(cp)}`);
	}
	isolated.add(cp);
	console.log(`Isolated: ${UNICODE.format(cp)}`);
}

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

	}
	disallow_char(cp);
}
for (let cp of CHARS_VALID) {
	if (valid.has(cp)) throw new Error(`Already valid: ${UNICODE.format(cp)}`);
	disallow_char(cp);
	valid.add(cp);
	console.log(`Added Valid: ${UNICODE.format(cp)}`);
}
for (let cp of (await import('./rules/chars-isolated.js')).default) {
	set_isolated(cp);
}
for (let info of emoji_chrs.Extended_Pictographic) { 
	if (!emoji_map.has(info.cp) && valid.has(info.cp)) {
		set_isolated(info.cp);
	}
}

// filter combining marks
let cm = new Set([...UNICODE.cm].filter(cp => valid.has(cp)));

// apply script changes
for (let cp of (await import('./rules/chars-common.js')).default) {
	let old = SCRIPTS.get_script_set(cp);
	for (let abbr of old) {
		SCRIPTS.require(abbr).set.delete(cp);
	}
	const relaxed = 'Zyyy';
	SCRIPTS.require(relaxed).set.add(cp);
	console.log(`Relaxed Script [${[...old].join('/')} => ${relaxed}]: ${UNICODE.format(cp)}`);
}
	
// filter scripts
for (let {set} of SCRIPTS.entries) {
	for (let cp of set) {
		if (!valid.has(cp)) {
			set.delete(cp); 
		}
	}
}

// check that everything makes sense
function has_adjacent_cm(cps) {
	for (let i = 1; i < cps.length; i++) {
		if (cm.has(cps[i]) && cm.has(cps[i-1])) {
			return true;
		}
	}
}
for (let cp of valid) {
	let decomposed = NF.nfd([cp]);
	if (has_adjacent_cm(decomposed)) {
		throw new Error(`Adjacent CM in Valid : ${UNICODE.format(cp, decomposed)}`);
	}
}
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
	let decomposed = NF.nfd(ys);
	if (has_adjacent_cm(decomposed)) {
		throw new Error(`Adjacent CM in Mapping: ${UNICODE.format(x, ys, decomposed)}`);
	}
	if (ys.includes(0x2E)) {
		throw new Error(`Mapping includes stop: ${UNICODE.format(x, ys)}`);
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
for (let cp of isolated) {	
	if (!valid.has(cp)) {
		isolated.delete(cp);
		console.log(`*** Isolated not Valid: ${UNICODE.format(cp)}`); // non fatal
	}
	if (cc.has(cp)) {
		throw new Error(`Isolated with non-zero combining class: ${UNICODE.format(cp)}`);
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

// load restricted scripts
let restricted = new Set();
// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
for (let abbr of SCRIPTS.excluded()) {
	restricted.add(abbr);
}
// https://www.unicode.org/reports/tr31/#Table_Limited_Use_Scripts
for (let abbr of SCRIPTS.limited()) {
	restricted.add(abbr);
}
// additional restricted scripts
for (let abbr of (await import('./rules/restricted-scripts.js')).default) {
	restricted.add(abbr);
}
// require existance, remove empty
restricted = [...restricted].map(abbr => SCRIPTS.require(abbr)).filter(x => x.set.size);
// require decomposed sanity
for (let script of restricted) {	
	let set = new Set(NF.nfd([...script.set])); // this is a good idea IMO
	for (let cp of set) {
		if (!script.set.has(cp)) {
			throw new Error(`Restricted script ${script.abbr} decomposition: ${UNICODE.format(cp)}`);
		}
	}
	script.restricted = set;
}
// remove unrestricted from restricted
let unrestricted_union = new Set(SCRIPTS.entries.flatMap(x => x.restricted ? [] : NF.nfd([...x.set]))); // see above
for (let script of restricted) {
	for (let cp of unrestricted_union) {
		script.restricted.delete(cp);
	}
}
restricted = restricted.filter(x => x.restricted.size); // remove empty
for (let script of restricted) {
	console.log(`Restricted [${script.abbr}]: ${script.set.size} => ${script.restricted.size}`);
}

// wholes
let wholes = await read_wholes(SCRIPTS);
for (let script of wholes) {
	console.log(`Wholes [${script.abbr}]: ${script.wholes.size}`);
}
// since restricted scripts cant intersect
// all the wholes can be unioned together
let restricted_wholes = new Set();
for (let {wholes} of restricted) {
	if (wholes) {
		for (let cp of wholes) {
			restricted_wholes.add(cp);
		}
		wholes.clear();
	} 
}
console.log(`Restricted Wholes: ${restricted_wholes.size}`);
wholes = wholes.filter(x => x.wholes.size); // remove restricted

// note: sorting isn't important, just nice to have
const created = new Date();
mkdirSync(out_dir, {recursive: true});
writeFileSync(new URL('./spec.json', out_dir), JSON.stringify({
	created,
	unicode: UNICODE.version_str,
	valid: sorted(valid),
	ignored: sorted(ignored),
	mapped: [...mapped.entries()].sort((a, b) => a[0] - b[0]),
	cm: sorted(cm),
	emoji: [...emoji.values()].map(x => x.cps).sort(compare_arrays),
	isolated: sorted(isolated),
	script_order: SCRIPT_ORDER,
	script_names: Object.fromEntries(SCRIPTS.entries.map(x => [x.abbr, x.name.replace('_', ' ')])),
	scripts: Object.fromEntries(SCRIPT_ORDER.map(abbr => [abbr, sorted(SCRIPTS.require(abbr).set)])),
	wholes: Object.fromEntries(wholes.map(x => [x.abbr, sorted(x.wholes)])),
	restricted: Object.fromEntries(restricted.map(x => [x.abbr, sorted(x.restricted)])),	
	restricted_wholes: sorted(restricted_wholes)
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
writeFileSync(new URL('./scripts.json', out_dir), JSON.stringify(SCRIPTS.entries, (_, x) => x instanceof Set ? [...x] : x));
