import {mkdirSync, writeFileSync, createWriteStream} from 'node:fs';
import {compare_arrays, parse_cp_sequence} from './utils.js';
import {UNICODE, NF, IDNA, SCRIPTS} from './unicode-version.js';

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

// missing data
const Regional_Indicator = new Set(UNICODE.regional_indicators());

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
	if (!valid.has(cp)) {
		throw new Error(`Isolated not Valid: ${UNICODE.format(cp)}`);
	}
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

let emoji_chrs = UNICODE.emoji_data();
let emoji_map = new Map(emoji_chrs.Emoji.map(x => [x.cp, x]));
let emoji_demoted = new Set((await import('./rules/emoji-demoted.js')).default);
for (let rec of emoji_map.values()) {
	if (emoji_demoted.has(rec.cp)) {
		rec.used = true;
		console.log(`Demoted Emoji: ${UNICODE.format(rec)}`);
	} else {
		disallow_char(rec.cp, true);
	}
}

// flag sequences with valid regions
UNICODE.valid_emoji_flag_sequences().forEach(register_emoji);
// disable single regionals
for (let cp of Regional_Indicator) {
	emoji_map.get(cp).used = true;
}

// register default emoji-presentation
for (let info of emoji_chrs.Emoji_Presentation) {
	if (Regional_Indicator.has(info.cp)) continue; // skipped
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
		console.log(`*** Blacklist Emoji: No match for ${UNICODE.format(cps)}`); // should this be fatal?
		continue;
	}
	console.log(`Blacklist Emoji by Sequence: ${UNICODE.format(info)}`);
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
let cm = new Set(UNICODE.general_category('M').filter(x => valid.has(x.cp)).map(x => x.cp));

// load scripts
let scripts = Object.fromEntries(SCRIPTS.entries.map(x => {
	return [x.abbr, new Set([...x.set].filter(cp => valid.has(cp)))];
}));

// apply changes
for (let cp of (await import('./rules/scripts.js')).default) {
	for (let [abbr0, set] of Object.entries(scripts)) {
		if (set.delete(cp)) {
			const abbr1 = 'Zyyy'; // TODO: generalize this
			scripts[abbr1].add(cp);
			console.log(`Changed Script [${abbr0} => ${abbr1}]: ${UNICODE.format(cp)}`);
			break;
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
	if (cc.has(cp)) {
		throw new Error(`Isolated with non-zero combining class: ${UNICODE.format(cp)}`);
	}
	if (!valid.has(cp)) {
		throw new Error(`Isolated not Valid: ${UNICODE.format(cp)}`);
	}
}

function sorted(v) {
	return [...v].sort((a, b) => a - b);
}


// load excluded scripts
let excluded = {};
for (let abbr of SCRIPTS.excluded()) {	
	let set  = scripts[abbr];
	if (!set) throw new TypeError(`Expected script: ${abbr}`);
	if (set.size == 0) continue;	
	let decomposed = new Set(NF.nfd([...set]));
	for (let cp of decomposed) {
		if (!set.has(cp)) {
			throw new Error(`Excluded script "${a}" decomposition: ${SPEC.format(cp)}`);
		}
	}
	excluded[abbr] = sorted(decomposed);
	console.log(`Excluded Script: ${abbr} (${decomposed.size})`);
}

// wholes
let wholes_Grek = (await import('./rules/confusables-Grek.js')).default.filter(cp => valid.has(cp));
let wholes_Cyrl = (await import('./rules/confusables-Cyrl.js')).default.filter(cp => valid.has(cp));

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
	scripts: {
		Latn: sorted(scripts.Latn),
		Grek: sorted(scripts.Grek),
		Cyrl: sorted(scripts.Cyrl),
	}, 
	excluded,
	wholes: {
		Grek: sorted(wholes_Grek),
		Cyrl: sorted(wholes_Cyrl),
	}
}));

writeFileSync(new URL('./nf.json', out_dir), JSON.stringify({
	created,
	unicode: UNICODE.version_str,
	ranks: UNICODE.combining_ranks(),
	exclusions: UNICODE.composition_exclusions(),
	decomp: UNICODE.decompositions(),
	qc: sorted(UNICODE.nf_props().NFC_QC.map(x => x[0]))
}));
writeFileSync(new URL('./nf-tests.json', out_dir), JSON.stringify(UNICODE.nf_tests()));

// not important
// convenience file for emoji.html
writeFileSync(new URL('./emoji-info.json', out_dir), JSON.stringify([...emoji.values()].map(info => {
	let {cps, name, version, type} = info;
	return {form: String.fromCodePoint(...cps), name, version, type};
})));
