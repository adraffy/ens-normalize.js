import {readFileSync} from 'fs';
import {join} from 'path';
import {compare_array} from './utils.js';
import {decode_emoji, lookup_linear, lookup_member_span} from './decoder.js';

function read_table(name) {
	return JSON.parse(readFileSync(join(tables_dir, `${name}.json`)));
}

let base_dir = new URL('.', import.meta.url).pathname;
let tables_dir = join(base_dir, 'tables-json');

throw new Error('TODO FIX THIS FOR NEW COMPRESSOR');

let {date, version, max_width, ...tables} = read_table('compressed');

let types = [
	['CM', 'combining-marks', 'span'],
	['I', 'ignored', 'span'],
	['D', 'disallowed', 'span'],
	['T', 'join-T', 'span'],
	['LD', 'join-LD', 'span'],
	['RD', 'join-RD', 'span'],
	['V', 'virama', 'member'],
	['L1', 'linear-1', 'linear'],
	['L2', 'linear-2', 'linear'],
	['E', 'emoji', 'emoji']
];
for (let i = 1; i <= max_width; i++) {
	types.push([`M${i}`, `mapped-${i}`, 'mapped', i]);
	types.push([`C${i}`, `constant-${i}`, 'linear']);
}

for (let [key, name, type, ...args] of types) {
	let original = read_table(name);
	let compressed = tables[key];
	if (!Array.isArray(compressed)) throw new Error(`unknown table key: ${key}`);
	delete tables[key];
	try {
		switch (type) {
			case 'span': {
				for (let c of original) {
					if (!lookup_member_span(compressed, c)) {
						throw new Error(`wtf ${c}`);
					}
				}
				break;
			}
			case 'member': {
				for (let c of original) {
					if (!lookup_linear(compressed, 1, 0, 1, 0, c)) {
						throw new Error(`wtf ${c}`);
					}
				}
				break;
			}
			case 'linear': {
				let {m, w, dx, dy} = original;
				for (let [a, n, b] of m) {
					for (let i = 0; i < n; i++) {
						let v = lookup_linear(compressed, 0, w, dx, dy, a + dx * i);
						if (!v) throw new Error(`wtf ${c}`);
						for (let j = 0; j < w; j++) {
							if (b[j] + dy * i != v[j]) throw new Error(`wtf ${c} on ${j}`);
						}
					}
				}
				break;
			}
			case 'mapped': {
				let [width] = args;
				for (let [c, v0] of original) {
					let v = lookup_linear(compressed, 1, width, 1, 0, c);
					if (!v || compare_array(v, v0) != 0) {
						throw new Error(`wtf ${c}`);
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
	} catch (cause) {
		console.error(cause);
		throw new Error(`table ${key} failed`, {cause});
	}
	console.log(`Table ${key} == ${name}`);
}

if (Object.keys(tables).length > 0) {
	throw new Error('unchecked tables');
}
