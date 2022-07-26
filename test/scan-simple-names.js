import REGISTERED from './data/eth-labels.js';
//import {read_combining_marks} from '../build/unicode-logic.js';
//import {explode_cp} from '../build/utils.js';
import {ens_tokenize} from '../build/lib-normalize-v2.js';


//let base_dir = new URL('.', import.meta.url).pathname;

let count = 0;

next: for (let name of REGISTERED) {
	//let cps = explode_cp(name).map(cp => [cp, cm.has(cp)]);
	//let m = split_between(cps, (_, [__, cm]) => !cm);

	let tokens = ens_tokenize(name);
	let cps = [];
	for (let t of tokens) {
		if (t.v) {
			cps.push(...t.v);
		} else if (t.m) {
			cps.push(...t.m)
		} else if (t.d) {
			continue next;
		}
	}
	if (/^[a-z0-9-_]+$/.test(String.fromCodePoint(...cps))) {
		count++;
	}
}

console.log(count);
console.log(count / REGISTERED.size);