import {ens_emoji} from '../src/lib.js';
import {get_heap_size} from '../derive/utils.js';
import {writeFileSync} from 'node:fs';

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

let mem0 = get_heap_size();
const NAIVE = make_regex(EMOJI);
let mem1 = get_heap_size();

console.log(`Length: ${NAIVE.toString().length}`);
console.log(`Bytes: ${mem1 - mem0}`);

writeFileSync(new URL('./emoji-regex.txt', import.meta.url), NAIVE.toString());
