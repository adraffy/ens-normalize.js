// norm(beautify(emoji w/o FE0F)) = norm(emoji)

import {ens_beautify, ens_emoji, ens_normalize} from '../src/lib.js';

let count = 0;
for (let cps of ens_emoji()) {
	let norm = ens_normalize(String.fromCodePoint(...cps));
	let beaut = ens_beautify(String.fromCodePoint(...cps.filter(cp => cp != 0xFE0F)));
	let beaut_norm = ens_normalize(beaut);
	if (norm !== beaut) count++;
	if (norm !== beaut_norm) {
		console.log({cps, norm0: norm, beaut, beaut_norm});
		throw new Error('wrong');
	}
}

console.log({count});
console.log('OK');
