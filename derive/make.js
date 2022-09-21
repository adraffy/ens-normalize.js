import {mkdirSync, writeFileSync, createWriteStream} from 'node:fs';
import {compare_arrays, parse_cp_range, parse_cp_sequence} from './utils.js';
import {UnicodeSpec} from './unicode-logic.js';
import {create_nf} from './nf.js';

import CHARS_VALID from './rules/chars-valid.js';
import CHARS_DISALLOWED from './rules/chars-disallow.js';
import CHARS_MAPPED from './rules/chars-mapped.js';
import EMOJI_DEMOTED from './rules/emoji-demoted.js';
import PICTO_PROMOTED from './rules/picto-promoted.js';
import EMOJI_WHITELIST from './rules/emoji-seq-whitelist.js';
import EMOJI_BLACKLIST from './rules/emoji-seq-blacklist.js';

// quick hack to capture log
((stream) => {
	let out = createWriteStream(new URL('./make.txt', import.meta.url).pathname);
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
	EMOJI_DEMOTED,
	PICTO_PROMOTED
});

const spec = new UnicodeSpec(new URL('./data/15.0.0/', import.meta.url));

const nf = create_nf(spec);
if (nf.run_tests().length) throw new Error('nf implementation wrong');
nf.run_random_tests();

console.log(`Build Date: ${new Date().toJSON()}`);
console.log(`Unicode Version: ${spec.version_str}`);

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
for (let cp of PICTO_PROMOTED) {
	disallow_char(cp);
	register_emoji({cps: [cp], type: 'Promoted', picto: true});
}
for (let info of emoji_chrs.Emoji_Presentation) {
	if (emoji_map.get(info.cp) && !RegionalIndicators.has(info.cp)) {
		emoji_map.delete(info.cp);
		register_emoji({cps: [info.cp, 0xFE0F], ...info});
	}
}
for (let info of emoji_chrs.Extended_Pictographic) {
	if (emoji_map.get(info.cp)) {
		emoji_map.delete(info.cp);
		register_emoji({cps: [info.cp], ...info, picto: true});
	}
}
for (let info of emoji_map.values()) {
	register_emoji({cps: [info.cp], ...info});
}

for (let seq of EMOJI_WHITELIST) {
	register_emoji({cps: parse_cp_sequence(seq), type: 'Whitelist'});
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

function sorted(v) {
	return [...v].sort((a, b) => a - b);
}

let out_dir = new URL('./output/', import.meta.url);
mkdirSync(out_dir, {recursive: true});
writeFileSync(new URL('./spec.json', out_dir), JSON.stringify({
	valid: sorted(valid),
	ignored: sorted(ignored),
	mapped: [...mapped.entries()].sort((a, b) => a[0] - b[0]),
	cm: sorted(cm),
	emoji: [...emoji.values()].filter(x => !x.picto).map(x => x.cps).sort(compare_arrays),
	picto: sorted([...emoji.values()].filter(x => x.picto).map(x => x.cps[0]))
}));

writeFileSync(new URL('./nf.json', out_dir), JSON.stringify({
	ranks: spec.combining_ranks(),
	exclusions: spec.composition_exclusions(),
	decomp: spec.decompositions(),
	qc: spec.nf_props().NFC_QC.map(x => x[0]).sort((a, b) => a - b)
}));
writeFileSync(new URL('./nf-tests.json', out_dir), JSON.stringify(spec.nf_tests()));
