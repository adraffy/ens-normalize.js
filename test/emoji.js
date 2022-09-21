// confirm that the trie can be expanded correctly

import {readFileSync} from 'fs';
import {ens_emoji} from '../src/lib.js';
import {str_from_cps} from '../src/utils.js';

let {picto, emoji} = JSON.parse(readFileSync(new URL('../derive/output/spec.json', import.meta.url)));
let emoji_seqs = [picto.map(x => [x]), emoji].flat();

console.log(`Picto: ${picto.length}`);
console.log(emoji_seqs.length);

let tally = {};
for (let cps of emoji_seqs) {
	tally[cps.length] = (tally[cps.length]|0) + 1;
}
console.log(tally);

let map = new Map(ens_emoji().map(v => [str_from_cps(v), v]));
for (let cps of emoji_seqs) {
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
