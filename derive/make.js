import {mkdirSync, writeFileSync} from 'node:fs';
import {compare_arrays, parse_cp_range, parse_cp_sequence} from './utils.js';
import {UnicodeSpec} from './unicode-logic.js';
import {create_nf} from './nf.js';

import CHARS_VALID from './rules/chars-valid.js';
import CHARS_DISALLOWED from './rules/chars-disallow.js';
import CHARS_MAPPED from './rules/chars-mapped.js';
import EMOJI_DEMOTED from './rules/emoji-demoted.js';
import EMOJI_WHITELIST from './rules/emoji-seq-whitelist.js';
import EMOJI_BLACKLIST from './rules/emoji-seq-blacklist.js';

const spec = new UnicodeSpec(new URL('./data/15.0.0/', import.meta.url));

const nf = create_nf(spec);
if (nf.run_tests().length) throw new Error('nf implementation wrong');
nf.run_random_tests();

const RegionalIndicators = new Set(parse_cp_range('1F1E6..1F1FF'));

const idna = spec.idna_rules({
	version: 2003, // https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
	use_STD3: true, 
	valid_deviations: true // because 200C and 200D were allowed
});

let ignored = new Set(idna.ignored);
let valid = new Set(idna.valid);
let mapped = new Map(idna.mapped);
let emoji = new Map();

function disallow_char(cp, quiet) {	
	let replacement = mapped.get(cp);
	if (replacement) {
		mapped.delete(cp);
		console.log(`Removed Mapped: ${spec.format(cp, replacement)}`);
	} else if (ignored.delete(cp)) {
		console.log(`Removed Ignored: ${spec.format(cp)}`);
	} else if (valid.delete(cp)) {
		if (!quiet) console.log(`Removed Valid: ${spec.format(cp)}`);
		for (let [x, ys] of mapped) {
			if (ys.includes(cp)) {
				mapped.delete(x);
				console.log(`--Mapping: ${spec.format(x, ys)}`);
			}
		}
	}
}

function register_emoji(info) {
	let key = String.fromCodePoint(...info.cps);
	let old = emoji.get(key);
	if (old) {
		console.log(old);
		console.log(info);
		throw new Error(`Duplicate emoji: ${key}`);
	}
	emoji.set(key, info);
}

let emoji_zwjs = spec.emoji_zwjs();
emoji_zwjs.RGI_Emoji_ZWJ_Sequence.forEach(register_emoji);

let emoji_seqs = spec.emoji_seqs();
emoji_seqs.Emoji_Keycap_Sequence.forEach(register_emoji);
emoji_seqs.RGI_Emoji_Tag_Sequence.forEach(register_emoji);
emoji_seqs.RGI_Emoji_Modifier_Sequence.forEach(register_emoji);

let emoji_chrs = spec.emoji_data();
let emoji_map = new Map(emoji_chrs.Emoji.map(x => [x.cp, x]));
for (let {cp} of emoji_map.values()) {
	if (EMOJI_DEMOTED.includes(cp)) {
		emoji_map.delete(cp);
		console.log(`Demoted Emoji: ${spec.format(cp)}`);
	} else {
		disallow_char(cp, true);
	}
}
for (let x of emoji_chrs.Emoji_Presentation) {
	if (emoji_map.get(x.cp) && !RegionalIndicators.has(x.cp)) {
		emoji_map.delete(x.cp);
		register_emoji({cps: [x.cp, 0xFE0F], ...x});
	}
}
for (let x of emoji_chrs.Extended_Pictographic) {
	if (emoji_map.get(x.cp)) {
		emoji_map.delete(x.cp);
		register_emoji({cps: [x.cp], ...x});
	}
}
for (let x of emoji_map.values()) {
	register_emoji({cps: [x.cp], ...x});
}

for (let seq of EMOJI_WHITELIST) {
	register_emoji({cps: parse_cp_sequence(seq)}); // we could name these?
}
for (let seq of EMOJI_BLACKLIST) {
	let cps = parse_cp_sequence(seq);
	let key = String.fromCodePoint(...cps);
	let info = emoji.get(key);
	if (!info) {
		console.log(`*** Blacklist Emoji: No match for ${spec.format(cps)}`);
		continue;
	}
	console.log(`Blacklist Emoji by Sequence: ${spec.format(info)}`);
	emoji.delete(key);
}
for (let [x, ys] of CHARS_MAPPED) {
	disallow_char(x);
	mapped.set(x, ys);
	console.log(`Added Mapped: ${spec.format(x, ys)}`);
}
for (let cp of CHARS_DISALLOWED) {
	disallow_char(cp);
}
for (let cp of CHARS_VALID) {
	disallow_char(cp);
	valid.add(cp);
	console.log(`Added Valid: ${spec.format(cp)}`);
}

// filter combining marks
let cm = new Set(spec.general_category('M').filter(x => valid.has(x.cp)).map(x => x.cp));

// check that everything makes sense
function has_adjacent_cm(cps) {
	for (let i = 1; i < cps.length; i++) {
		if (cm.has(cps[i]) && cm.has(cps[i-1])) {
			return true;
		}
	}
}
for (let cp of valid) {
	let decomposed = nf.nfd([cp]);
	if (has_adjacent_cm(decomposed)) {
		throw new Error(`Adjacent CM in Valid : ${spec.format(cp, decomposed)}`);
	}
}
for (let cp of ignored) {
	if (valid.has(cp)) {
		throw new Error(`Ignored is valid: ${spec.format(cp)}`);
	} else if (mapped.has(cp)) {
		throw new Error(`Ignored is mapped: ${spec.format(cp)}`);
	}
}
for (let [x, ys] of mapped.entries()) {
	if (valid.has(x)) {
		throw new Error(`Mapped is valid: ${spec.format(x)}`);
	}
	for (let cp of ys) {
		if (!valid.has(cp)) {
			throw new Error(`Mapping isn't invalid: ${spec.format(x, ys)} @ ${spec.format(cp)}`);
		}
	}
	let decomposed = nf.nfd(ys);
	if (has_adjacent_cm(decomposed)) {
		throw new Error(`Adjacent CM in Mapping: ${spec.format(x, ys, decomposed)}`);
	}
	if (ys.includes(0x2E)) {
		throw new Error(`Mapping includes stop: ${spec.format(x, ys)}`);
	}
}

let out_dir = new URL('./output/', import.meta.url);
mkdirSync(out_dir, {recursive: true});
writeFileSync(new URL('./emoji.json', out_dir), JSON.stringify([...emoji.values()].map(x => x.cps).sort(compare_arrays)));
writeFileSync(new URL('./chars.json', out_dir), JSON.stringify({
	valid: [...valid],
	ignored: [...ignored],
	mapped: [...mapped.entries()],
	cm: [...cm],
}));

writeFileSync(new URL('./nf.json', out_dir), JSON.stringify({
	ranks: spec.combining_ranks(),
	exclusions: spec.composition_exclusions(),
	decomp: spec.decompositions(),
	qc: spec.nf_props().NFC_QC.map(x => x[0])
}));
writeFileSync(new URL('./nf-tests.json', out_dir), JSON.stringify(spec.nf_tests()));
