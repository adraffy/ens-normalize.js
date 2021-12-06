import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {Encoder} from './encoder.js';

let base_dir = new URL('.', import.meta.url).pathname;
let parsed_dir = join(base_dir, 'unicode-json');
let tables_dir = join(base_dir, 'tables-json');

function read_parsed(name) {
	return JSON.parse(readFileSync(join(parsed_dir, `${name}.json`)));
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
mapped = mapped.group_by(x => x[1].length, []); // group by length 
for (let i = 0; i < mapped.length; i++) mapped[i] = mapped[i] ?? []; // fix empty items
for (let i = 1; i < mapped.length; i++) {
	console.log(`Mapped ${i}: ${mapped[i].length}`);
}

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
let {["9"]: class_virama} = read_parsed('DerivedCombiningClass');
class_virama = cps_from_ranges(class_virama);
console.log(`Virama: ${class_virama.length}`);

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

// merged
let join_LD = assert_sorted_unique([join_L, join_D].flat().sort((a, b) => a - b));
let join_RD = assert_sorted_unique([join_R, join_D].flat().sort((a, b) => a - b));

// assumption: merged compress better than separate
let enc_LR = new Encoder();
enc_LR.write_member(join_LD);
enc_LR.write_member(join_RD);
let enc_LRD = new Encoder();
enc_LRD.write_member(join_L);
enc_LRD.write_member(join_R);
enc_LRD.write_member(join_D);
if (enc_LR.buf.length > enc_LRD.buf.length) {
	throw new Error('Assumption wrong: LRD');
}

// Emoji rules for 200D
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

// ************************************************************
// export tables for inspection

mkdirSync(tables_dir, {recursive: true});

function write_table(name, json) {
	let file = join(tables_dir, `${name}.json`);
	writeFileSync(file, JSON.stringify(json));
	console.log(`Wrote: ${file}`);
}

write_table('combining-marks', combining_marks);
write_table('ignored', ignored);
write_table('disallowed', disallowed); // warning: this is huge
write_table('join-T', join_T);
write_table('join-LD', join_LD);
write_table('join-RD', join_RD);
write_table('virama', class_virama);
write_table('emoji', emoji);
for (let i = 1; i < mapped.length; i++) {
	write_table(`mapped-${i}`, mapped[i]);
}

// ************************************************************
// compress tables 

let enc = new Encoder();
enc.write_member(combining_marks);
enc.write_member(ignored);
enc.write_member(disallowed);
enc.write_member(join_T);
enc.write_member(join_LD);
enc.write_member(join_RD);
enc.write_member(class_virama);
enc.write_emoji(emoji);
enc.write_mapped([
	[1, 1, 1], // alphabets: ABC
	[1, 2, 2], // paired-alphabets: AaBbCc
	[1, 1, 0], // \ 
	[2, 1, 0], //  adjacent that map to a constant
	[3, 1, 0]  // /   eg. AAAA..BBBB => CCCC
], mapped);

writeFileSync(join(tables_dir, 'huffman.bin'), Buffer.from(enc.buf));
writeFileSync(join(tables_dir, 'compressed.bin'), Buffer.from(enc.compressed()));

console.log(`Bytes: ${enc.buf.length}`);

// ************************************************************
// helper functions

// parse and flatten list of hex ranges
function cps_from_ranges(v) {
	return assert_sorted_unique(v.map(cps_from_range).flat().sort((a, b) => a - b));
}
// parse range of hex cps
// "AAAA"       => [0xAAAA]
// "AAAA..BBBB" => [0xAAAA, ..., 0xBBBB]
function cps_from_range(s) {
	let [lo, hi] = s.split('..');
	lo = parseInt(lo, 16);
	if (!Number.isSafeInteger(lo) || lo < 0) throw new TypeError('expected code point');
	if (!hi) return [lo];
	hi = parseInt(hi, 16);
	if (!Number.isSafeInteger(hi) || hi < lo) throw new TypeError('expected upper code point');
	return Array(hi - lo + 1).fill().map((_, i) => lo + i);
}
// parse sequence of hex cps
// "AAAA BBBB CCCC" => [0xAAAA, 0xBBBB, 0xCCCC]
function cps_from_sequence(s) {
	return s.split(/\s+/).map(x => parseInt(x, 16));
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