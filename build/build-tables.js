import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {} from './utils.js'; // Array.prototype injections

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
// split off linear sequences, like alphabets
function linear(step) {
	let m = mapped[1]
		// flatten [a, [b]] to [a, b] and keep a reference to the original
		.map(x => [x[0], x[1][0], x])
		// find adjacent by step size
		.split((a, b) => b[0] == a[0] + step && b[1] == a[1] + step)
		// find reasonably large groups
		.filter(v => v.length >= 3)
		// collapse into a span
		.map(v => {
			let [[a, b]] = v;
			v.forEach(x => x[2][0] = -1); // mark for removal
			return [a, step * v.length, b];
		});
	// remove marked
	mapped[1] = mapped[1].filter(x => x[0] >= 0);
	return m;
}
let mapped_linear1 = linear(1);
let mapped_linear2 = linear(2);
console.log(`Linear +1: ${mapped_linear1.length}`);
console.log(`Linear +2: ${mapped_linear2.length}`);
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
// assumption: sparse
if (compress_member_as_set(class_virama).length > compress_member_as_span(class_virama).length) { 
	throw new Error('Assumption wrong: V');
}

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
// assumption: merged compress better than separate
let join_LD = assert_sorted_unique([join_L, join_D].flat().sort((a, b) => a - b));
let join_RD = assert_sorted_unique([join_R, join_D].flat().sort((a, b) => a - b));
if (compress_member_as_span(join_L).length + compress_member_as_span(join_R).length + compress_member_as_span(join_D).length 
  < compress_member_as_span(join_LD).length + compress_member_as_span(join_RD).length) {
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
for (let i = 1; i < mapped.length; i++) {
	write_table(`mapped-${i}`, mapped[i]);
}
write_table('linear-1', mapped_linear1); // note: these are compact
write_table('linear-2', mapped_linear2); 
write_table('emoji', emoji);

// ************************************************************
// compress tables 

let tables = {
	CM: compress_member_as_span(combining_marks),
	I: compress_member_as_span(ignored),
	D: compress_member_as_span(disallowed),
	T: compress_member_as_span(join_T),
	LD: compress_member_as_span(join_LD),
	RD: compress_member_as_span(join_RD),
	V: compress_member_as_set(class_virama),
	L1: compress_linear_mapped(mapped_linear1),
	L2: compress_linear_mapped(mapped_linear2),
	E: compress_zwnj_emoji(emoji)
};
for (let i = 1; i < mapped.length; i++) {
	tables[`M${i}`] = compress_mapped(mapped[i]);
}

write_table('compressed', {
	date: new Date(),                // date of build
	version: read_parsed('version'), // version/date of download
	max_width: mapped.length - 1,    // width of largest mapped table
	...tables
});

//writeFileSync(join(tables_dir, 'compressed.bin'), Buffer.concat(Object.values(tables).map(Buffer.from)));

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

// ************************************************************
// compression techniques
// note: these are inverted by decoder.js

// encode an unsigned integer as [1-4] bytes
function huffman(i) {
	if (i < 0x80) return [i];
	i -= 0x80;
	if (i < 0x7F00) return [0x80 | (i >> 8), i & 0xFF];
	i -= 0x7F00;
	return [255, i >> 16, (i >> 8) & 0xFF, i & 0xFF];
}

// encode a signed integer as [1-4] bytes
function signed_huffman(i) {
	return huffman(i < 0 ? -1 - 2 * i : 2 * i);
}

// input: [cp, ...]
function compress_member_as_set(v) {
	return v.delta().map(huffman).flat();
}
function compress_member_as_span(v) {
	let a = 0;
	return v.split((a, b) => b - a == 1).map(v => {		
		let delta = v[0] - a; // always positive
		a = v[0] + v.length;
		return [...huffman(delta), ...huffman(v.length)];
	}).flat();
}

// input: [[cp0, n, cp1], ...]
function compress_linear_mapped(m) {
	let a = 0;
	let b = 0;
	return m.map(([cp0, n, cp1]) => {
		let delta0 = cp0 - a; // always positive
		a = cp0 + n;
		let delta1 = cp1 - b; // signed
		b = cp1;
		return [...huffman(delta0), ...huffman(n), ...signed_huffman(delta1)];
	}).flat();
}

// input: [[cp0, [cp...]], ...]
function compress_mapped(m) {
	let a = 0;
	let b = 0;
	return m.map(([cp0, cps]) => {
		let delta0 = cp0 - a; // always positive
		a = cp0;
		return [...huffman(delta0), ...cps.map(cp => {
			let delta = cp - b;
			b = cp;
			return signed_huffman(delta);
		}).flat()];
	}).flat();
}

// input: [[cp, ...], ...]
function compress_zwnj_emoji(emoji) {
	// remove FE0F
	emoji = emoji.map(v => v.filter(x => x != FE0F));
	// group by (width and position of ZWNJ)
	emoji = Object.values(emoji.group_by(v => [v.length, ...v.indices_of(ZWNJ)].join(':')));
	// transpose and remove ZWNJ
	return emoji.map(m => {
		// m = [A Z B Z C] => Tr(m) = [A A]
		//     [A Z B Z D]    w/o     [B B]
		// pos = [1,  3]      ZWNJ    [C D]
		let [first] = m;
		let zwnj = first.indices_of(ZWNJ);
		let rest = first.map((_, i) => i).filter(i => zwnj.indexOf(i) < 0);
		return [
			huffman(m.length),     // number of elements 
			huffman(first.length), // true width of emoji
			// bit positions of ZWNJ
			huffman(zwnj.reduce((a, i) => a | (1 << (i - 1)), 0)),
			// take every column of emoji sequences that aren't ZWNJ and delta compress
			...rest.map(i => m.map(v => v[i]).delta().map(signed_huffman).flat())
		].flat();
	}).flat();
}