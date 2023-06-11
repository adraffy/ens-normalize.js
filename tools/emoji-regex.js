// compile all Emoji into a single regex
// a more formal version (but not ENS-specific) of this idea: https://github.com/adraffy/emoji.js

import {ens_emoji} from '../src/lib.js';
import {writeFileSync} from 'node:fs';

// if (typeof gc === 'undefined') {
// 	throw new Error(`node --expose-gc tools/emoji-regex.js`);
// }

const EMOJI = ens_emoji();

function make_regex(emoji) {
	return new RegExp(`^(${emoji.map(cps => String.fromCodePoint(...cps.flatMap(cp => {
		switch (cp) {
			case 0x2A: return [0x5C, cp]; // escape *
			case 0xFE0F: return [cp, 0x3F]; // 0-1
			default: return cp;
		}
	}))).join('|')})`, 'u');
}


let mem0 = process.memoryUsage().heapUsed;
const NAIVE = make_regex(EMOJI);
let mem1 = process.memoryUsage().heapUsed;

console.log(`Length: ${NAIVE.toString().length}`);
console.log(`Bytes: ${mem1 - mem0}`); // approximately 3MB?

writeFileSync(new URL('./output/emoji-regex.txt', import.meta.url), NAIVE.toString());
