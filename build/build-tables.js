import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {Encoder} from './encoder.js';
import {nfc} from './nf0.js';
import {parse_cp, parse_cp_range, parse_cp_sequence, escape_unicode, split_ascending, 
	take_from, group_by, split_on, compare_array, tally, split_between} from './utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let tables_dir = join(base_dir, 'tables-json');
let output_dir = join(base_dir, 'output');

mkdirSync(tables_dir, {recursive: true});
mkdirSync(output_dir, {recursive: true});

function read_parsed(name) {
	return JSON.parse(readFileSync(join(base_dir, 'unicode-json', `${name}.json`)));
}

function write_table(name, json) {
	let file = join(tables_dir, `${name}.json`);
	writeFileSync(file, JSON.stringify(json));
	console.log(`Wrote table: ${file}`);
}

// EIP-137: Ethereum Domain Name Service - Specification
// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
// --transitional=false 
// --useSTD3AsciiRules=true

// https://www.unicode.org/reports/tr46/#IDNA_Mapping_Table
// https://unicode.org/reports/tr46/#ProcessingStepMap
let {
	// the code point is valid, and not modified.
	disallowed,
	// the code point is removed: this is equivalent to mapping the code point to an empty string.
	ignored,
	// the code point is replaced in the string by the value for the mapping.
	mapped,
	// the status is disallowed if UseSTD3ASCIIRules=true (the normal case); 
	// implementations that allow UseSTD3ASCIIRules=false would treat the code point as mapped.
	disallowed_STD3_mapped,
	// disallowed_STD3_valid: the status is disallowed if UseSTD3ASCIIRules=true (the normal case); 
	// implementations that allow UseSTD3ASCIIRules=false would treat the code point as valid.
	disallowed_STD3_valid,
	// NV8 is only present if the status is valid but the character is excluded by IDNA2008 from all domain names for all versions of Unicode.
	valid_NV8,
	// XV8 is present when the character is excluded by IDNA2008 for the current version of Unicode.
	valid_XV8
	// deviations
	// because transitional=false, remain valid
} = read_parsed('IdnaMappingTable');

// ignored characters
ignored = flatten_ranges(ignored);
console.log(`Ignored: ${ignored.length}`);

// mapped characters
// these map to an output sequence: [char] => [char, char, ...]
mapped = mapped.map(([src, dst]) => {
	let cps = parse_cp_sequence(dst);
	return parse_cp_range(src).map(x => [x, cps]);
}).flat().sort((a, b) => a[0] - b[0]);
assert_sorted_unique(mapped.map(x => x[0]));

// disallowed characters according to IDNA2003
// https://unicode.org/reports/tr46/#UseSTD3ASCIIRules
// merge disallowed_STD3* into disallowed due to useSTD3AsciiRules=true
disallowed.push(...disallowed_STD3_mapped.map(([x, _]) => x));
disallowed.push(...disallowed_STD3_valid); 
disallowed = flatten_ranges(disallowed);
let disallowed_idna2003 = disallowed.slice();

// change mapped stops to disallowed
let mapped_stops = take_from(mapped, ([_, ys]) => ys.includes(0x2E));
if (mapped_stops.some(([_, ys]) => ys.length > 1)) {
	throw new Error(`Assumption wrong: expected 1-width stop`);
}
let disallowed_stops = mapped_stops.map(([x]) => x);

// additional disallowed by idna2008
let disallowed_idna2008_extra = flatten_ranges(valid_NV8.concat(valid_XV8));

// merge into disallowed
disallowed = int_union(disallowed.concat(disallowed_idna2008_extra, disallowed_stops));
console.log(`Disallowed: ${disallowed.length}`);

let mapped_by_w = group_by(mapped, x => x[1].length, []); // group by length 
mapped_by_w.forEach((v, w) => console.log(`Mapped ${w}: ${v.length}`));

// emoji
const ZWJ = 0x200D;
const FE0F = 0xFE0F;
if (!ignored.includes(FE0F)) { // assumption: FE0F is ignored 
	throw new Error('Assumption wrong: FE0F not ignored');
}
let emoji_data = map_values(read_parsed('emoji-data'), e => e.flatMap(parse_cp_range));
let emoji_seq = map_values(read_parsed('emoji-sequences'), e => e.flatMap(({hex}) => {
	return hex.includes('..') ? parse_cp_range(hex).map(x => [x]) : [parse_cp_sequence(hex)]
}));

let {Emoji, Emoji_Modifier_Base, Emoji_Presentation} = emoji_data;
// check that Emoji_Presentation is a subset of emoji
if (Emoji_Presentation.some(cp => !Emoji.includes(cp))) {
	throw new Error(`Assumption wrong: Emoji_Presentation not emoji`);
}
// check that Emoji_Modifier_Base is a subset of emoji
if (Emoji_Modifier_Base.some(cp => !Emoji.includes(cp))) {
	throw new Error(`Assumption wrong: Emoji_Modifier_Base not emoji`);
}
// these are not defined for some reason
let emoji_REGIONAL = flatten_ranges(['1F1E6..1F1FF']);
let emoji_KEYCAP = flatten_ranges(['23', '2A', '30..39']);
let emoji_TAG_SPEC = flatten_ranges(['E0020..E007E']); // these are not emoji
take_from(Emoji, cp => emoji_REGIONAL.includes(cp));
take_from(Emoji, cp => emoji_KEYCAP.includes(cp));

// find the emoji that are disallowed according to idna2003
// we can enable them by adding FE0F
let emoji_disallowed_idna2003 = take_from(Emoji, cp => disallowed_idna2003.includes(cp));

// find the emoji that are mapped by idna2003
// these can never be emoji
let emoji_mapped_idna2003 = take_from(Emoji, cp => mapped.some(([x]) => x == cp));






/*
if (emoji_data.Emoji_Modifier_Base.some(cp => emoji_data.Emoji.includes(cp))) {
	throw new Error(`Assumption wrong: Emoji_Modifier_Base is an Emoji`);
}
*/



//let emoji_TAG_END = cps_from_ranges(['E007F']);

/*
console.log(emoji_disallowed_idna2003.map(x => x.toString(16)));
write_table('emoji-grandfather', emoji_disallowed_idna2003.map(x => [String.fromCodePoint(x), x.toString(16)]));
*/

/*
let emoji_std = read_parsed('emoji-sequences');
for (let [k, v] of Object.entries(emoji_std)) {
	emoji_std[k] = v.flatMap(({hex}) => hex.includes('..') ? parse_cp_range(hex).map(x => [x]) : [parse_cp_sequence(hex)]);
}
if (Object.values(emoji_std).flat().some(v => compare_array(nfc(v), v) != 0)) {
	throw new Error(`Assumption wrong: Emoji affected by NFC`);
}
delete emoji_std.RGI_Emoji_Tag_Sequence; // handled algorithmically (also incomplete), see: casefold
delete emoji_std.Emoji_Keycap_Sequence;  // handled algorithmically 
// flatten remaining types
emoji_std = Object.values(emoji_std).flat();
if (emoji_std.some(v => v.includes(ZWJ))) { // assumption: every emoji 
	throw new Error('Assumption wrong: Standard Emoji with ZWJ')
}
// separate the emoji that are [x, FE0F] where x is disallowed
function is_blank_FE0F(v) {
	return v.length == 2 && v[1] == FE0F;
}
let emoji_blank_FE0F;
[emoji_std, emoji_blank_FE0F] = group_by(emoji_std, v => is_blank_FE0F(v)|0, []);
emoji_blank_FE0F = assert_sorted_unique(emoji_blank_FE0F.map(([x]) => x));
if (emoji_std.some(v => v.includes(FE0F))) {
	throw new Error(`Assumption wrong: Standard Emoji with FE0F`);
}
let emoji_zwj = read_parsed('emoji-zwj-sequences').map(x => parse_cp_sequence(x.hex));
if (!emoji_zwj.every(v => v.indexOf(ZWJ) >= 1)) { // assumption: every ZWJ emoji has a ZWJ (not at the start)
	throw new Error('Assumption wrong: ZWJ Emoji missing ZWJ');
}
// break the sequences into chunks
// remove the blank FE0F pairs
let [emoji_zwj_rest, emoji_zwj_blank_FE0F] = group_by(emoji_zwj.flatMap(v => split_on(v, ZWJ)), v => is_blank_FE0F(v)|0, []);
emoji_zwj_blank_FE0F = [...new Set(emoji_zwj_blank_FE0F.map(([x]) => x))];
if (emoji_zwj_blank_FE0F.some(x => !emoji_blank_FE0F.includes(x))) {
	throw new Error(`Assumption wrong: ZWJ Emoji contains unknown emoji blank-FE0F`);
}
if (emoji_zwj_rest.some(v => !emoji_std.some(u => compare_array(u, v) == 0))) {
	throw new Error(`Assumption wrong: ZWJ Emoji contains unknown emoji`);
}
// this implies that every zwj sequence
*/

/*
let emoji_chunk_table = tally(emoji_zwj.map(u => split_on(u, ZWJ).map(v => v.join())).flat());
emoji_chunk_table = Object.entries(emoji_chunk_table).map(([key, n]) => [key, n, key.split(',').map(x => parseInt(x))]);
emoji_chunk_table = emoji_chunk_table.sort((a, b) => {
	let c = b[1] - a[1];
	if (c == 0) c = compare_array(a[2], b[2]);
	return c;
});
let emoji_chunk_map = Object.fromEntries(emoji_chunk_table.map(([key], i) => [key, i]));
//emoji_zwj_rest = [...new Set(emoji_zwj_rest.concat(emoji_zwj_blank_FE0F.map(x => [x, FE0F])).map(x => x.join()))];
let emoji_zwj_chunk_id = emoji_zwj.map(u => split_on(u, ZWJ).map(v => emoji_chunk_map[v.join()]));
let emoji_zwj_chunks = emoji_chunk_table.map(v => v[2]);


console.log(emoji_chunk_table);
//console.log(emoji_zwj_chunk_id);
//console.log(emoji_zwj_chunks);

//emoji_zwj_rest = emoji_zwj_rest.map(x => x.split(',').map(x => parseInt));

//writeFileSync('./test-e.json', JSON.stringify(emoji_zwj_chunk_id));

throw 1;


disallowed = new Set(disallowed);
let emoji_dis = emoji_std.flat().filter(x => disallowed.delete(x));
disallowed = [...disallowed];

console.log(`Disallowed: ${disallowed.length}`);
console.log(`Emoji Disallowed: ${emoji_dis.length}`);
console.log(`Blank+FE0F Emoji: ${emoji_blank_FE0F.length}`);
console.log(`STD Emoji: ${emoji_std.length}`);
console.log(`ZWJ Emoji: ${emoji_zwj.length}`);
write_table('emoji-blank-fe0f', emoji_blank_FE0F);
*/


// https://unicode.org/reports/tr46/#Validity_Criteria
// Section 4.1 Rule #5
// General_Category=Mark
let categories = read_parsed('DerivedGeneralCategory');
let combining_marks = flatten_ranges(Object.entries(categories).filter(([k]) => k.startsWith('M')).map(([_, v]) => v).flat());
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
combining_class = Object.entries(combining_class).map(([k, v]) => [parseInt(k), v.map(parse_cp_range).flat()]).sort((a, b) => a[0] - b[0]);
combining_class.forEach(([c, v]) => console.log(`Combining ${c}: ${v.length}`));
let virama_index = combining_class.findIndex(x => x[0] == '9'); // virama
if (virama_index < 0) {
	throw new Error(`Assumption wrong: no virama`);
}
combining_class = combining_class.map(x => x[1]); // drop the class, we just need order

// ContextJ rules for 200C
// eg. RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D}))
let {T: join_T, L: join_L, R: join_R, D: join_D} = read_parsed('DerivedJoiningType');
join_T = flatten_ranges(join_T);
join_L = flatten_ranges(join_L);
join_R = flatten_ranges(join_R);
join_D = flatten_ranges(join_D);
console.log(`Join T: ${join_T.length}`);
console.log(`Join L: ${join_L.length}`);
console.log(`Join R: ${join_R.length}`);
console.log(`Join D: ${join_D.length}`);
let join_LD = assert_sorted_unique(int_sort([join_L, join_D].flat()));
let join_RD = assert_sorted_unique(int_sort([join_R, join_D].flat()));
if (!is_smaller([join_LD, join_RD], [join_L, join_R, join_D])) {
	throw new Error('Assumption wrong: LRD');
}

// emoji 
//let emoji = Object.values(read_parsed('emoji-sequences')).flat().map(x => cps_from_sequence(x.hex));
//let emoji_zwj = read_parsed('emoji-zwj-sequences').map(x => cps_from_sequence(x.hex));




/*
let emoji_cps = new Set(emoji_zwj.flat());
emoji_cps.delete(ZWJ);
emoji_cps.delete(FE0F);
emoji_cps = [...emoji_cps];
if (emoji_cps.some(x => disallowed.indexOf(x) >= 0 || ignored.indexOf(x) >= 0)) {
	//console.log(emoji_cps.filter(x => disallowed.indexOf(x) >= 0));
	
	let set = new Set(cps_from_ranges(valid_NV8));
	console.log(set.size);
	emoji_cps.forEach(x => set.delete(x));
	disallowed_og.forEach(x => set.delete(x));
	console.log(set.size);
	//console.log(set);
	writeFileSync('./banned.json', JSON.stringify([...set].map(x => [x, x.toString(16).padStart(4, '0'), String.fromCodePoint(x)]), null, 2));
	console.log([...set]);
	//console.log(emoji_cps.filter(x => ignored.indexOf(x) >= 0));

	throw new Error('Assumption wrong: Emoji contains invalid code-point');
}
*/

// ContextO rules
let scripts = read_parsed('Scripts');
for (let [k, v] of Object.entries(scripts)) {
	scripts[k] = flatten_ranges(v);
}
let scripts_HKN_parts = [scripts.Hiragana, scripts.Katakana, scripts.Han];
let scripts_HKH = assert_sorted_unique(int_sort(scripts_HKN_parts.flat()));
if (!is_smaller([scripts_HKH], scripts_HKN_parts)) {
	throw new Error(`Assumption wrong: R_AL`);
}

// normalization decomposition
let decomp = read_parsed('Decomposition_Mapping');
decomp = decomp.map(([x, ys]) => [parse_cp(x), parse_cp_sequence(ys)]);
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
	bidi[k] = flatten_ranges(v);
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

write_table('combining-marks', combining_marks);
write_table('ignored', ignored);
write_table('disallowed', disallowed); // warning: this is huge
write_table('join-T', join_T);
write_table('join-LD', join_LD);
write_table('join-RD', join_RD);
write_table('comp-exclusions', comp_exclusions);
//write_table('virama', class_virama);
write_table('combining-class', combining_class);
//write_table('emoji', emoji_zwj);
mapped_by_w.forEach((v, w) => write_table(`mapped-${w}`, v));
decomp.forEach((v, i) => write_table(`decomp-${i}`, v));
write_table('bidi', bidi);
write_table('scripts', scripts);
//write_table('allowed-emoji', emoji_dis);

// ************************************************************
// compress tables 

function write_payload(name, enc) {
	let buf = Buffer.from(enc.compress_arithmetic());
	writeFileSync(join(output_dir, `${name}.js`), `export default '${btoa(String.fromCharCode(...buf))}'`);
	writeFileSync(join(output_dir, `${name}.bin`), buf);
	writeFileSync(join(output_dir, `${name}.json`), JSON.stringify(enc.values));
	console.log(`Wrote payload ${name}: ${buf.length} bytes`);
}

let enc_bidi = new Encoder();
enc_bidi.write_member(bidi_R_AL);
enc_bidi.write_member(bidi.L);
enc_bidi.write_member(bidi.AN);
enc_bidi.write_member(bidi.EN);
enc_bidi.write_member(bidi_ECTOB);
enc_bidi.write_member(bidi.NSM);
write_payload('bidi', enc_bidi);

let enc_nf = new Encoder();
enc_nf.positive(combining_class.length);
for (let c of combining_class) enc_nf.write_member(c);
enc_nf.write_mapped([	
	[1, 1, 1],
	[1, 1, 0]
], decomp);
enc_nf.write_member(comp_exclusions);
write_payload('nf', enc_nf);

let enc_uts = new Encoder(); //params);
enc_uts.write_member(combining_marks);
enc_uts.write_member(ignored);
enc_uts.write_member(disallowed);
enc_uts.write_mapped([
	[1, 1, 1], // alphabets: ABC
	[1, 2, 2], // paired-alphabets: AaBbCc
	[1, 1, 0], // \ 
	[2, 1, 0], //  adjacent that map to a constant
	[3, 1, 0]  // /   eg. AAAA..BBBB => CCCC
], mapped_by_w);
//enc_uts.write_member(emoji_blank_FE0F);
//enc_uts.write_emoji(emoji_zwj.map(v => v.filter(x => x != FE0F)), ZWJ);
write_payload('uts', enc_uts);

let enc_ctx = new Encoder();
enc_ctx.write_member(join_T);
enc_ctx.write_member(join_LD);
enc_ctx.write_member(join_RD);
//enc_ctx.write_emoji(emoji_zwj);
enc_ctx.write_member(combining_class[virama_index]);
enc_ctx.write_member(scripts.Greek);
enc_ctx.write_member(scripts.Hebrew);
enc_ctx.write_member(scripts_HKH);
write_payload('context', enc_ctx);



let enc_emoji = new Encoder();
enc_emoji.write_member(emoji_disallowed_idna2003);
enc_emoji.write_member(emoji_REGIONAL);
enc_emoji.write_member(emoji_KEYCAP);
enc_emoji.write_member(Emoji);
enc_emoji.write_member(emoji_data.Emoji_Modifier);
enc_emoji.write_member(Emoji_Modifier_Base);
//enc_emoji.write_member(Emoji_Presentation);
enc_emoji.write_member(emoji_TAG_SPEC);
//enc_emoji.write_member(emoji_TAG_END);
//enc_emoji.write_emoji(emoji_zwj);
write_payload('emoji', enc_emoji);

//writeFileSync(join(output_dir, `bidi.bin`), Buffer.from(enc.compress_arithmetic()));


// ************************************************************
// helper functions

function map_values(obj, fn) {
	return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

function int_union(v) {
	return int_sort([...new Set(v)]);
}

function int_sort(v) {
	return v.sort((a, b) => a - b);
}

// parse and flatten list of hex ranges
function flatten_ranges(v) {
	return assert_sorted_unique(int_sort(v.map(parse_cp_range).flat()));
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
	let ns = s.compress_arithmetic().length;
	let nb = b.compress_arithmetic().length;
	console.log(`Smaller(${ns}) vs Bigger(${nb})`);
	return ns < nb;
}