import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {Encoder} from './encoder.js';
import {cps_from_range, cps_from_sequence, group_by} from './utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

function read_parsed(name) {
	return JSON.parse(readFileSync(join(base_dir, 'unicode-json', `${name}.json`)));
}

// EIP-137: Ethereum Domain Name Service - Specification
// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
// --transitional=false 
// --useSTD3AsciiRules=true

// https://unicode.org/reports/tr46/#ProcessingStepMap
let {
	disallowed,
	ignored,
	mapped,
	disallowed_STD3_mapped,
	disallowed_STD3_valid,
} = read_parsed('IdnaMappingTable');

// deviations
// because transitional=false, these remain valid

// ignored characters
ignored = cps_from_ranges(ignored);
console.log(`Ignored: ${ignored.length}`);

// disallowed characters
// https://unicode.org/reports/tr46/#UseSTD3ASCIIRules
// merge disallowed_STD3* into disallowed due to useSTD3AsciiRules=true
disallowed.push(...disallowed_STD3_mapped.map(x => x[0])); // mapped are [x, y]
disallowed.push(...disallowed_STD3_valid);                 // valid is just x
disallowed = cps_from_ranges(disallowed);
console.log(`Disallowed: ${disallowed.length}`);

// mapped characters
// these map to an output sequence: [char] => [char, char, ...]
mapped = mapped.map(([src, dst]) => {
	let cps = cps_from_sequence(dst);
	return cps_from_range(src).map(x => [x, cps]);
}).flat().sort((a, b) => a[0] - b[0]);
assert_sorted_unique(mapped.map(x => x[0]));
mapped = group_by(mapped, x => x[1].length, []); // group by length 
mapped.forEach((v, i) => console.log(`Mapped ${i}: ${v.length}`));

// https://unicode.org/reports/tr46/#Validity_Criteria
// Section 4.1 Rule #5
// General_Category=Mark
let categories = read_parsed('DerivedGeneralCategory');
let combining_marks = cps_from_ranges(Object.entries(categories).filter(([k]) => k.startsWith('M')).map(([_, v]) => v).flat());
console.log(`Combining Marks: ${combining_marks.length}`);

// https://unicode.org/reports/tr46/#Validity_Criteria
// Section 4.1 Rule #7
// ContextJ rules 
// 200C: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1 => Virama & Joining_Type
// 200D: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2 => Virama 

/*
let {["9"]: class_virama} = read_parsed('DerivedCombiningClass');
class_virama = cps_from_ranges(class_virama);
console.log(`Virama: ${class_virama.length}`);
*/
let combining_class = read_parsed('DerivedCombiningClass');
delete combining_class['0']; // we dont need class 0
combining_class = Object.entries(combining_class).map(([k, v]) => [parseInt(k), v.map(cps_from_range).flat()]).sort((a, b) => a[0] - b[0]);
combining_class.forEach(([c, v]) => console.log(`Combining ${c}: ${v.length}`));
let virama_index = combining_class.findIndex(x => x[0] == '9'); // virama
if (virama_index < 0) {
	throw new Error(`Assumption wrong: no virama`);
}
combining_class = combining_class.map(x => x[1]); // drop the class, we just need order

// ContextJ rules for 200C
// eg. RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D}))
let {T: join_T, L: join_L, R: join_R, D: join_D} = read_parsed('DerivedJoiningType');
join_T = cps_from_ranges(join_T);
join_L = cps_from_ranges(join_L);
join_R = cps_from_ranges(join_R);
join_D = cps_from_ranges(join_D);
console.log(`Join T: ${join_T.length}`);
console.log(`Join L: ${join_L.length}`);
console.log(`Join R: ${join_R.length}`);
console.log(`Join D: ${join_D.length}`);
let join_LD = assert_sorted_unique(int_sort([join_L, join_D].flat()));
let join_RD = assert_sorted_unique(int_sort([join_R, join_D].flat()));
if (!is_smaller([join_LD, join_RD], [join_L, join_R, join_D])) {
	throw new Error('Assumption wrong: LRD');
}

// emoji rules for 200D
let emoji = read_parsed('emoji-zwj-sequences');
emoji = emoji.map(x => cps_from_sequence(x.codes));
console.log(`Emoji: ${emoji.length}`);
const ZWNJ = 0x200D;
const FE0F = 0xFE0F;
if (!emoji.every(v => v.indexOf(ZWNJ) >= 1)) { // assumption: every emoji has ZWNJ after position 1
	throw new Error('Assumption wrong: Emoji ZWNJ');
}
if (!ignored.includes(FE0F)) { // assumption: FE0F is ignored
	throw new Error('Assumption wrong: Emoji FE0F');
}
let emoji_cps = new Set(emoji.flat());
emoji_cps.delete(ZWNJ);
emoji_cps.delete(FE0F);
emoji_cps = [...emoji_cps];
if (emoji_cps.some(x => disallowed.indexOf(x) >= 0 || ignored.indexOf(x) >= 0)) {
	throw new Error('Assumption wrong: Emoji contains invalid code-point');
}

// normalization decomposition
let decomp = read_parsed('Decomposition_Mapping');
decomp = decomp.map(([x, ys]) => [parseInt(x, 16), cps_from_sequence(ys)]);
// for some stupid reason, hangul not included
// also the mapping is characters, not hex
//decomp.push(...read_parsed('Jamo').map(([x, y]) => [parseInt(x, 16), [...y].map(x => x.codePointAt(0))]));
decomp.sort((a, b) => a[0] - b[0]);
decomp = group_by(decomp, x => x[1].length, []);
decomp.forEach((v, i) => console.log(`Decomp ${i}: ${v.length}`));

// normalization composition
let comp_exclusions = read_parsed('CompositionExclusions');
comp_exclusions = comp_exclusions.map(x => parseInt(x, 16));
comp_exclusions.sort((a, b) => a - b);
console.log(`Composition Exclusions: ${comp_exclusions.length}`);

// bidi
let bidi = read_parsed('DerivedBidiClass');
for (let [k, v] of Object.entries(bidi)) {
	bidi[k] = cps_from_ranges(v);
}
let bidi_R_AL_parts = [bidi.R, bidi.AL];
let bidi_ECTOB_parts =[bidi.ES, bidi.CS, bidi.ET, bidi.ON, bidi.BN];

let bidi_R_AL = assert_sorted_unique(int_sort(bidi_R_AL_parts.flat()));
let bidi_ECTOB = assert_sorted_unique(int_sort(bidi_ECTOB_parts.flat()));
if (!is_smaller([bidi_R_AL], bidi_R_AL_parts)) {
	throw new Error(`Assumption wrong: R_AL`);
}
if (!is_smaller([bidi_ECTOB], bidi_ECTOB_parts)) {
	throw new Error(`Assumption wrong: ECTOB`);
}

// ************************************************************
// export tables for inspection

let tables_dir = join(base_dir, 'tables-json');

mkdirSync(tables_dir, {recursive: true});

function write_table(name, json) {
	let file = join(tables_dir, `${name}.json`);
	writeFileSync(file, JSON.stringify(json));
	console.log(`Wrote table: ${file}`);
}

write_table('combining-marks', combining_marks);
write_table('ignored', ignored);
write_table('disallowed', disallowed); // warning: this is huge
write_table('join-T', join_T);
write_table('join-LD', join_LD);
write_table('join-RD', join_RD);
write_table('comp-exclusions', comp_exclusions);
//write_table('virama', class_virama);
write_table('combining-class', combining_class);
write_table('emoji', emoji);
mapped.forEach((v, i) => write_table(`mapped-${i}`, v));
decomp.forEach((v, i) => write_table(`decomp-${i}`, v));
write_table('bidi', bidi);

// ************************************************************
// compress tables 

function compress(enable_nfc, enable_bidi) { //}, params) {
	let enc = new Encoder(); //params);
	enc.write_member(combining_marks);
	enc.write_member(ignored);
	enc.write_member(disallowed);
	enc.write_member(join_T);
	enc.write_member(join_LD);
	enc.write_member(join_RD);
	enc.write_mapped([
		[1, 1, 1], // alphabets: ABC
		[1, 2, 2], // paired-alphabets: AaBbCc
		[1, 1, 0], // \ 
		[2, 1, 0], //  adjacent that map to a constant
		[3, 1, 0]  // /   eg. AAAA..BBBB => CCCC
	], mapped);
	enc.write_emoji(emoji);
	if (enable_nfc) {
		enc.positive(combining_class.length);
		for (let c of combining_class) enc.write_member(c);
		enc.unsigned(virama_index);
		enc.write_mapped([	
			[1, 1, 1],
			[1, 1, 0]
		], decomp);
		enc.write_member(comp_exclusions);
	} else {
		enc.write_member(combining_class[virama_index]);
	}
	if (enable_bidi) {
		enc.write_member(bidi_R_AL);
		enc.write_member(bidi.L);
		enc.write_member(bidi.AN);
		enc.write_member(bidi.EN);
		enc.write_member(bidi_ECTOB);
		enc.write_member(bidi.NSM);
	}
	return enc;
}


let output_dir = join(base_dir, 'output');

mkdirSync(output_dir, {recursive: true});

for (let nfc of [true, false]) {
	for (let bidi of [true, false]) {
		let enc = compress(nfc, bidi);
		let params = `-nfc=${nfc}-bidi=${bidi}`;
		writeFileSync(join(output_dir, `values${params}.json`), JSON.stringify(enc.values));
		writeFileSync(join(output_dir, `huffman${params}.bin`), Buffer.from(enc.compress_huffman()));
		let buf = Buffer.from(enc.compress_arithmetic());
		writeFileSync(join(output_dir, `arithmetic${params}.bin`), buf);
		console.log(`Wrote ${params}: ${buf.length} bytes`);
	}
}

// ************************************************************
// helper functions

function int_sort(v) {
	return v.sort((a, b) => a - b);
}

// parse and flatten list of hex ranges
function cps_from_ranges(v) {
	return assert_sorted_unique(int_sort(v.map(cps_from_range).flat()));
}

// shit the bed if not sorted and unique
function assert_sorted_unique(v) {
	for (let i = 1; i < v.length; i++) {
		if (v[i - 1] >= v[i]) {
			throw new Error('not sorted unique');
		}
	}
	return v;
}

function is_smaller(smaller, bigger) {
	let s = new Encoder();
	for (let x of smaller) s.write_member(x);
	let b = new Encoder();
	for (let x of bigger) b.write_member(x);
	return s.compress_arithmetic().length < b.compress_arithmetic().length;
}