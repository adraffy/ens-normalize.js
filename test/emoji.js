// confirm that the trie can be expanded correctly

import {EMOJI} from '@adraffy/ensip-norm';
import {ens_emoji} from '../src/lib.js';
import {str_from_cps} from '../src/utils.js';

console.log(`Emoji: ${EMOJI.length}`);

let tally = {};
for (let v of EMOJI) {
	tally[v.length] = (tally[v.length]|0) + 1;
}
console.log(tally);

let map = Object.fromEntries(ens_emoji().map(v => [str_from_cps(v), v]));

for (let emoji of EMOJI) {
	let key = str_from_cps(emoji);
	if (!map[key]) {
		console.log({key, emoji});
		console.log('Missing emoji');
		process.exit(1);
	}
	delete map[key];
}
let m = Object.entries(map);
if (m.length) {
	console.log(m);
	console.log('Extra emoji');
	process.exit(2);
}

console.log('OK');