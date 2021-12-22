import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {parse_cp_range, parse_cp_sequence, take_from} from './utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let tables_dir = join(base_dir, 'tables-json');

mkdirSync(tables_dir, {recursive: true});

function read_parsed(name) {
	return JSON.parse(readFileSync(join(base_dir, 'unicode-json', `${name}.json`)));
}
function dump_json(name, json) {
	let file = join(tables_dir, `${name}.json`);
	writeFileSync(file, JSON.stringify(json));
	console.log(`Wrote table: ${file}`);
}

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
} = read_parsed('IdnaMappingTable');

// ignored characters
ignored = ignored.flatMap(parse_cp_range);

// disallowed characters
// https://unicode.org/reports/tr46/#UseSTD3ASCIIRules
// merge disallowed_STD3* into disallowed due to useSTD3AsciiRules=true
disallowed.push(...disallowed_STD3_mapped.map(([x, _]) => x));
disallowed.push(...disallowed_STD3_valid); 
disallowed = disallowed.flatMap(parse_cp_range);

// mapped characters
mapped = mapped.flatMap(([src, dst]) => {
	let cps = parse_cp_sequence(dst);
	return parse_cp_range(src).map(x => [x, cps]);
});

// emoji
let emoji = read_parsed('emoji-data').Emoji.flatMap(parse_cp_range);

// find the emoji that are disallowed according to IDNA2003
// we can enable them by adding FE0F
let emoji_disallowed = take_from(emoji, cp => disallowed.includes(cp));
dump_json('emoji-idna2003-disallowed', emoji_disallowed);

// find the emoji that are mapped by idna2003
// these can never be emoji
let emoji_mapped = take_from(emoji, cp => mapped.some(([x]) => x == cp));
dump_json('emoji-idna2003-mapped', emoji_mapped);