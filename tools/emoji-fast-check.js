import {ens_normalize, ens_emoji} from '../src/lib.js';
import {explode_cp} from '../src/utils.js';

let max = 0;
let min = Infinity;
let all = new Set();
for (let cps of ens_emoji()) {
	let norm = ens_normalize(String.fromCodePoint(...cps));
	let v = new TextEncoder().encode(norm);
	min = Math.min(min, v.length);
	max = Math.max(max, v.length);
	for (let cp of explode_cp(norm)) {
		all.add(cp);
	}
}

console.log({min, max});
console.log(Math.min(...all), Math.max(...all));
