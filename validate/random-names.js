// generate names using a distribution with custom weights
// depends on acess to /derive/ outputs

import {readFileSync, writeFileSync} from 'node:fs';
import {ens_normalize} from '../src/lib.js';
import {random_choice} from './utils.js';

let chars = JSON.parse(readFileSync(new URL('../derive/output/chars.json', import.meta.url)));
let emoji = JSON.parse(readFileSync(new URL('../derive/output/emoji.json', import.meta.url)));

let sets = [
	[2, chars.valid.map(x => [x])],
	[3, chars.mapped.map(x => [x[0]])],
	[1, chars.ignored.map(x => [x])],
	[2, chars.cm.map(x => [x])],
	[4, emoji],
];

let weight_sum = sets.reduce((a, x) => a + x[0], 0);
sets.forEach(x => x[0] /= weight_sum);

function random_seq() {
	let r0 = Math.random();
	let r = r0;
	for (let i = 0; i < sets.length; i++) {
		r -= sets[i][0];
		if (r < 0) {
			return random_choice(sets[i][1]); 
		}
	}
	throw new Error('impossibru');
}

for (let i =0; i < 100; i++) {
	let v = random_seq();
	if (!Array.isArray(v)) {
		console.log(v, i);
		throw new Error('wtf');
	}
}

function random_name(n) {
	let v = [];
	while (v.length < n) {
		v.push(...random_seq());
	}
	return String.fromCodePoint(...v);
}

function generate_random(samples, len, fn) {
	let ret = [];
	let set = new Set();
	while (ret.length < samples) {
		let name = random_name(len);
		let test = fn(name);
		if (test && set.add(name)) ret.push(test);
	}
	return ret;
}

function needs_norm(name) {
	try {
		let norm = ens_normalize(name);
		if (name != norm) {
			return name;
		}
	} catch (err) {		
	}
}
function norm_fails(name) {
	try {
		ens_normalize(name);
	} catch (err) {		
		return name;
	}
}


let names = [];
for (let fn of [needs_norm, norm_fails]) {
	for (let b = 3, a = 5; a < 40; [a,b] = [a+b,a]) {
		names.push(...generate_random(2000, a, fn));
	}
}

console.log(`Names: ${names.length}`);

writeFileSync(new URL('./random-names.json', import.meta.url), JSON.stringify(names, null, '\t'));
