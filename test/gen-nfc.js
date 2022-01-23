
import {writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {parse_cp_range} from '../build/utils.js';
import {read_parsed} from '../build/nodejs-utils.js';
import {nfc} from '../build/nf.js';

const ALL_SCRIPT_CPS = Object.values(read_parsed('Scripts')).flatMap(v => v.flatMap(parse_cp_range));

const BASE_DIR = new URL('.', import.meta.url).pathname;
const OUTPUT_DIR = join(BASE_DIR, 'output');
mkdirSync(OUTPUT_DIR, {recursive: true});

/*
for (let cp = 0; cp <= 0x10FFFF; cp++) {
	try {
		String.fromCodePoint(cp);
	} catch (ignored) {
		continue;
	}
}
*/

console.log('Before: ', ALL_SCRIPT_CPS.length);

let set = new Set();
for (let cp of ALL_SCRIPT_CPS) {
	for (let x of nfc([cp])) {
		set.add(x);
	}
}
console.log('After: ', set.size);

writeFileSync(join(OUTPUT_DIR, 'cps-post-nfc.json'), JSON.stringify([...set].sort((a, b) => a - b)));
