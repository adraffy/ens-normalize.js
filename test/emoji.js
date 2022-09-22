// confirm that the trie can be expanded correctly

import {readFileSync} from 'fs';
import {ens_emoji} from '../src/lib.js';
import {str_from_cps} from '../src/utils.js';

let {emoji} = JSON.parse(readFileSync(new URL('../derive/output/spec.json', import.meta.url)));

console.log(emoji.length);

let tally = {};
for (let cps of emoji) {
	tally[cps.length] = (tally[cps.length]|0) + 1;
}
console.log(tally);

let map = new Map(ens_emoji().map(v => [str_from_cps(v), v]));
for (let cps of emoji) {
	let form = str_from_cps(cps);
	if (!map.delete(form)) {
		console.log({form, cps});
		throw new Error('missing emoji');
	}
}
if (map.size) {
	console.log(map);
	throw new Error('extra emoji');
}

console.log('OK');
