import {mkdirSync, writeFileSync, createWriteStream, readFileSync} from 'node:fs';
import {compare_arrays, explode_cp, parse_cp_sequence} from './utils.js';
import {SPEC, NF, IDNA} from './unicode-version.js';

import CHARS_VALID from './rules/chars-valid.js';
import CHARS_DISALLOWED from './rules/chars-disallow.js';
import CHARS_MAPPED from './rules/chars-mapped.js';
import CHARS_ISOLATED from './rules/chars-isolated.js';
import EMOJI_DEMOTED from './rules/emoji-demoted.js';
import EMOJI_WHITELIST from './rules/emoji-seq-whitelist.js';
import EMOJI_BLACKLIST from './rules/emoji-seq-blacklist.js';

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

function assert_distinct(things) {
	let m = Object.entries(things).map(([k, v]) => [k, new Set(v)]);
	for (let i = 0; i < m.length; i++) {
		let set_i = m[i][1];
		for (let j = i + 1; j < m.length; j++) {
			let set_j = m[j][1];
			for (let x of set_i) {
				if (set_j.has(x)) {
					console.log(m[i][0], m[j][0], x);
					throw new Error("distinct");
				}
			}
		}
	}
}
assert_distinct({
	CHARS_VALID, 
	CHARS_DISALLOWED, 
	MAPPED: CHARS_MAPPED.map(x => x[0]),
	EMOJI_DEMOTED
});

const Regional_Indicator = new Set(SPEC.props().Regional_Indicator);

console.log(`Build Date: ${new Date().toJSON()}`);
console.log(`Unicode Version: ${SPEC.version_str}`);

let ignored = new Set(IDNA.ignored);
let valid = new Set(IDNA.valid);
let mapped = new Map(IDNA.mapped);
let isolated = new Set();
let emoji = new Map();

function disallow_char(cp, quiet) {	
	let replacement = mapped.get(cp);
	if (replacement) {
		mapped.delete(cp);
		console.log(`Removed Mapped: ${SPEC.format(cp, replacement)}`);
	} else if (ignored.delete(cp)) {
		console.log(`Removed Ignored: ${SPEC.format(cp)}`);
	} else if (valid.delete(cp)) {
		if (!quiet) console.log(`Removed Valid: ${SPEC.format(cp)}`);
		for (let [x, ys] of mapped) {
			if (ys.includes(cp)) {
				mapped.delete(x);
				console.log(`--Mapping: ${SPEC.format(x, ys)}`);
			}
		}
	}
}

function register_emoji(info) {
	try {
		let {cps} = info;
		if (!Array.isArray(cps) || !cps.length) throw new Error('expected cps');
		if (!info.type) throw new Error('expected type');
		let key = String.fromCodePoint(...cps);
		let old = emoji.get(key);
		if (old) {
			console.log(old);
			throw new Error(`duplicate`);
		}
		if (!info.name) throw new Error('expected name');
		console.log(`Register Emoji: ${SPEC.format(info)}`);		
		emoji.set(key, info);
	} catch (err) {
		console.log(info);
		throw new Error(`Register Emoji: ${err.message}`);
	}
}

function set_isolated(cp) {
	if (!valid.has(cp)) {
		throw new Error(`Isolated not Valid: ${SPEC.format(cp)}`);
	}
	isolated.add(cp);
	console.log(`Isolated: ${SPEC.format(cp)}`);
}

let emoji_zwjs = SPEC.emoji_zwjs();
emoji_zwjs.RGI_Emoji_ZWJ_Sequence.forEach(register_emoji);

let emoji_seqs = SPEC.emoji_seqs();
emoji_seqs.Emoji_Keycap_Sequence.forEach(register_emoji);
emoji_seqs.RGI_Emoji_Tag_Sequence.forEach(register_emoji);
emoji_seqs.RGI_Emoji_Modifier_Sequence.forEach(register_emoji);

let emoji_chrs = SPEC.emoji_data();
let emoji_map = new Map(emoji_chrs.Emoji.map(x => [x.cp, x]));
for (let rec of emoji_map.values()) {
	if (EMOJI_DEMOTED.includes(rec.cp)) {
		rec.used = true;
		console.log(`Demoted Emoji: ${SPEC.format(rec)}`);
	} else {
		disallow_char(rec.cp, true);
	}
}

/*
if (false) { // whitelist flags
	let regions = JSON.parse(readFileSync(new URL('./data/regions.json', import.meta.url)));
	let cps = [...Regional_Indicator];
	if (cps.length != 26) throw new Error('expected 26');
	for (let cp of cps) {
		let rec = emoji_map.get(info.cp);
		if (!rec) throw new Error(`Expected emoji: ${SPEC.format(cp)}`);
		//rec.used = true; // disable single regionals	
	}
	let dx = cps[0] - 0x41; // 'A'
	for (let region of regions) {
		register_emoji({
			cps: explode_cp(region).map(x => x + dx),
			name: `Flag Sequence: ${region}`,
			type: 'Flag'
		});
	}
}
*/

// register default emoji-presentation
for (let info of emoji_chrs.Emoji_Presentation) {
	if (Regional_Indicator.has(info.cp)) continue; // skipped
	let rec = emoji_map.get(info.cp);
	if (!rec) throw new Error(`Expected emoji: ${SPEC.format(info)}`);
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
for (let info of EMOJI_WHITELIST) {
	register_emoji({cps: parse_cp_sequence(info.hex), type: 'Whitelisted', name: info.name});
}
for (let seq of EMOJI_BLACKLIST) {
	let cps = parse_cp_sequence(seq);
	let key = String.fromCodePoint(...cps);
	let info = emoji.get(key);
	if (!info) {
		console.log(`*** Blacklist Emoji: No match for ${SPEC.format(cps)}`); // should this be fatal?
		continue;
	}
	console.log(`Blacklist Emoji by Sequence: ${SPEC.format(info)}`);
	emoji.delete(key);
}
for (let [x, ys] of CHARS_MAPPED) {
	disallow_char(x);
	mapped.set(x, ys);
	console.log(`Added Mapped: ${SPEC.format(x, ys)}`);
}
for (let cp of CHARS_DISALLOWED) {
	disallow_char(cp);
}
for (let cp of CHARS_VALID) {
	disallow_char(cp);
	valid.add(cp);
	console.log(`Added Valid: ${SPEC.format(cp)}`);
}
for (let cp of CHARS_ISOLATED) {
	set_isolated(cp);
}
for (let info of emoji_chrs.Extended_Pictographic) { 
	if (!emoji_map.has(info.cp) && valid.has(info.cp)) {
		set_isolated(info.cp);
	}
}

// filter combining marks
let cm = new Set(SPEC.general_category('M').filter(x => valid.has(x.cp)).map(x => x.cp));

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
		throw new Error(`Adjacent CM in Valid : ${SPEC.format(cp, decomposed)}`);
	}
}
for (let cp of ignored) {
	if (valid.has(cp)) {
		throw new Error(`Ignored is valid: ${SPEC.format(cp)}`);
	} else if (mapped.has(cp)) {
		throw new Error(`Ignored is mapped: ${SPEC.format(cp)}`);
	}
}
for (let [x, ys] of mapped.entries()) {
	if (valid.has(x)) {
		throw new Error(`Mapped is valid: ${SPEC.format(x)}`);
	}
	for (let cp of ys) {
		if (!valid.has(cp)) {
			throw new Error(`Mapping isn't invalid: ${SPEC.format(x, ys)} @ ${SPEC.format(cp)}`);
		}
	}
	let decomposed = NF.nfd(ys);
	if (has_adjacent_cm(decomposed)) {
		throw new Error(`Adjacent CM in Mapping: ${SPEC.format(x, ys, decomposed)}`);
	}
	if (ys.includes(0x2E)) {
		throw new Error(`Mapping includes stop: ${SPEC.format(x, ys)}`);
	}
}
let cc = new Set(SPEC.chars.filter(x => x.cc > 0).map(x => x.cp)); 
for (let info of emoji.values()) {
	let {cps} = info;
	if (cc.has(cps[0]) || cc.has(cps[cps.length-1])) {
		console.log(info);
		throw new Error(`Emoji with non-zero combining class boundary: ${SPEC.format(info)}`);
	}
}
for (let cp of isolated) {
	if (cc.has(cp)) {
		throw new Error(`Isolated with non-zero combining class: ${SPEC.format(cp)}`);
	}
}

let scripts = SPEC.scripts({abbr: true});
let script_map = Object.fromEntries(scripts.map(([k, v]) => { 
	return [k, sorted(v.filter(cp => valid.has(cp)))];
}));
let script_sets = scripts.map(([k, cps]) => [k, new Set(cps)]);
function get_script_cover(cps) {
	let cover = new Set();
	for (let cp of cps) {
		for (let [name, set] of script_sets) {
			if (set.has(cp)) {
				cover.add(name);
			}
		}
	}
	return cover;
}

let confusables = SPEC.confusables();
let confuse_groups = confusables.map(([target, cps]) => {
	return {target, cps, cover: get_script_cover([target, cps].flat())};
});

// find all characters of script0 that are linked 
// by confusables to ANY of the provided scripts
function whole_script_confusables(abbr0, ...abbrs) {
	let whole = [];	
	let script = new Set(script_map[abbr0]);
	for (let {cps, cover} of confuse_groups) {
		if (cover.has(abbr0) && abbrs.some(abbr => cover.has(abbr))) {
			for (let cp of cps) {
				if (script.delete(cp)) {
					whole.push(cp);
				}
			}
		}
	}
	return sorted(whole);
}

let {Latn, Grek, Cyrl} = script_map;

//console.log(String.fromCodePoint(...whole_script_confusables('Grek', 'Latn', 'Cyrl')));
//console.log(String.fromCodePoint(...whole_script_confusables('Cyrl', 'Latn', 'Grek')));

function sorted(v) {
	return [...v].sort((a, b) => a - b);
}

// sorting isn't important, just nice to have
mkdirSync(out_dir, {recursive: true});
writeFileSync(new URL('./spec.json', out_dir), JSON.stringify({
	valid: sorted(valid),
	ignored: sorted(ignored),
	mapped: [...mapped.entries()].sort((a, b) => a[0] - b[0]),
	cm: sorted(cm),
	emoji: [...emoji.values()].map(x => x.cps).sort(compare_arrays),
	isolated: sorted(isolated),
	scripts: {Latn, Grek, Cyrl}, // already sorted
	wholes: {
		Grek: whole_script_confusables('Grek', 'Latn', 'Cyrl'), // already
		Cyrl: whole_script_confusables('Cyrl', 'Latn', 'Grek'), // sorted
	}
}));

writeFileSync(new URL('./nf.json', out_dir), JSON.stringify({
	ranks: SPEC.combining_ranks(),
	exclusions: SPEC.composition_exclusions(),
	decomp: SPEC.decompositions(),
	qc: SPEC.nf_props().NFC_QC.map(x => x[0]).sort((a, b) => a - b)
}));
writeFileSync(new URL('./nf-tests.json', out_dir), JSON.stringify(SPEC.nf_tests()));
