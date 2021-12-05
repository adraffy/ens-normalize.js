import {readFileSync} from 'fs';
import {join} from 'path';
import {compare_array} from './utils.js';
import {decode_emoji, lookup_linear, lookup_mapped, lookup_member, lookup_member_span} from './decoder.js';

function read_table(name) {
	return JSON.parse(readFileSync(join(tables_dir, `${name}.json`)));
}

let base_dir = new URL('.', import.meta.url).pathname;
let tables_dir = join(base_dir, 'tables-json');

let {date, version, max_width, ...tables} = read_table('compressed');

let types = [
	['CM', 'combining-marks', 'span'],
	['I', 'ignored', 'span'],
	['D', 'disallowed', 'span'],
	['T', 'join-T', 'span'],
	['LD', 'join-LD', 'span'],
	['RD', 'join-RD', 'span'],
	['V', 'virama', 'member'],
	['L1', 'linear-1', 'linear', 1],
	['L2', 'linear-2', 'linear', 2],
	['E', 'emoji', 'emoji']
];
for (let i = 1; i <= max_width; i++) {
	types.push([`M${i}`, `mapped-${i}`, 'mapped', i]);
}

for (let [key, name, type, arg] of types) {
	let original = read_table(name);
	let compressed = tables[key];
	if (!Array.isArray(compressed)) throw new Error(`unknown table key: ${key}`);
	delete tables[key];
	switch (type) {
		case 'span': {
			for (let c of original) {
				if (!lookup_member_span(compressed, c)) {
					throw new Error('wtf');
				}
			}
			break;
		}
		case 'member': {
			for (let c of original) {
				if (!lookup_member(compressed, c)) {
					throw new Error('wtf');
				}
			}
			break;
		}
		case 'linear': {
			// arg is step
			for (let [a, n, b] of original) {
				for (let i = 0; i < n; i += arg) {
					let mapped = lookup_linear(compressed, arg, a + i);
					if (!mapped || mapped.length != 1 || mapped[0] != b + i) {
						//console.log({a, n, b, i, mapped});
						throw new Error('wtf');
					}
				}
			}
			break;
		}
		case 'mapped': {
			// arg is width
			for (let [c, v] of original) {
				let mapped = lookup_mapped(compressed, arg, c);
				if (!mapped || compare_array(mapped, v) != 0) {
					throw new Error('wtf');
				}
			}
			break;
		}
		case 'emoji': {
			// emoji are in groups, by ZWNJ offset
			// so collapse, sort, remove duplicates
			let emoji = decode_emoji(compressed).flat().sort(compare_array).split((a, b) => compare_array(a, b) == 0).map(x => x[0]);
			// the original emoji still have FE0F
			original = original.map(v => v.filter(x => x != 0xFE0F)).sort(compare_array);			
			if (emoji.length != original.length) throw new Error('wtf length');
			for (let i = 0; i < original.length; i++) {
				if (compare_array(emoji[i], original[i]) != 0) {
					throw new Error('wtf');
				}
			}
			break;
		}
		default: throw new Error(`unknown table type: ${type}`)
	}
	console.log(`Table ${key} == ${name}`);
}

if (Object.keys(tables).length > 0) {
	throw new Error('unchecked tables');
}
