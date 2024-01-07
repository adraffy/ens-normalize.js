// upper bound on valid 3cp names

import {ens_normalize, nfc} from '../src/lib.js';
import {read_spec} from '../validate/data.js';
import {random_sample, str_from_cps} from '../src/utils.js';
import {tuples, explode_cp, compare_arrays} from '../derive/utils.js';

const SPEC = read_spec();

const CM = new Set(SPEC.cm);
const NORM_EMOJI = SPEC.emoji.map(v => explode_cp(ens_normalize(str_from_cps(v))));

const EMOJI_1 = NORM_EMOJI.filter(v => v.length == 1);
const EMOJI_2 = NORM_EMOJI.filter(v => v.length == 2);
const EMOJI_3 = NORM_EMOJI.filter(v => v.length == 3);

console.log([EMOJI_1, EMOJI_2, EMOJI_3].map(v => [v[0].length, v.length]));

let total = EMOJI_3.length;
for (let g of SPEC.groups) {
	let valid = [...new Set([...EMOJI_1, ...g.primary, ...g.secondary])];	
	
	let spaceAAA = [valid.filter(x => !CM.has(x)), valid, valid];	
	let spaceAB = [valid.filter(x => !CM.has(x)), EMOJI_2];
	let spaceBA = [EMOJI_2, valid];

	let raw = product(spaceAAA) + product(spaceAB) + product(spaceBA);
	total += raw;
	console.log(g.name, g.primary.length, valid.length, raw);

}
console.log(Number.isSafeInteger(total))
console.log(total);


function product(space) {
	return space.reduce((a, x) => a * x.length, 1);
}

function count_nfc(space) {
	let n = 0;
	for (let v of tuples(space)) {
		let cps = v.flat();
		if (!compare_arrays(nfc(cps), cps)) {
			++n;
		}
	}
	return n;
}

function count_norm(space) {
	let n = 0;
	for (let v of tuples(space)) {
		try {
			ens_normalize(str_from_cps(v.flat()));
			++n;
		} catch (err) {
		}
	}
	return n;
}
