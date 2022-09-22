// generate names using a distribution with custom weights
// depends on acess to /derive/ outputs

import {readFileSync, writeFileSync} from 'node:fs';
import {ens_normalize} from '../src/lib.js';
import {random_choice} from '../src/utils.js';

let {valid, mapped, ignored, cm, emoji} = JSON.parse(readFileSync(new URL('../derive/output/spec.json', import.meta.url)));

let distrib = [
	[2, valid],
	[3, mapped],
	[1, ignored],
	[2, cm],
	[4, emoji],
];

// norm and sort by prob
// coerce samples to sequences
let weight_sum = distrib.reduce((a, x) => a + x[0], 0);
distrib = distrib.map(([w, v]) => [w / weight_sum, v.map(x => [x].flat(Infinity))]).sort((a, b) => b[0] - a[0]); 

// choose from weighted distribution
function random_seq() {
	let r0 = Math.random();
	let r = r0;
	let i = 0;
	for (let e = distrib.length-1; i < e; i++) {
		r -= distrib[i][0];
		if (r < 0) break;
	}
	return random_choice(distrib[i][1]); 
}

for (let i = 0; i < 100; i++) {
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
