import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {random_choice} from '../build/utils.js';
import {ens_normalize} from '../index.js';

let base_dir = new URL('.', import.meta.url).pathname;

let derived = JSON.parse(readFileSync(join(base_dir, '../build/output/release-1-hr.json')));

let sets = [
	derived.mapped.map(x => [x[0]]),
	derived.ignored.map(x => [x]),
	derived.combining_marks.map(x => [x]),
	derived.style_legacy.map(x => [x, 0xFE0F]),
	derived.keycap_legacy.map(x => [x, 0xFE0F, 0x20E3]),
	derived.whitelist_zwj.map(v => v.flatMap(x => x === 0x200D ? [0xFE0F, x] : x))
];
//function dampen(x) { return Math.min(100, x); }
function dampen(x) { return x; }
let len = sets.reduce((a, set) => a + dampen(set.length), 0);
let probs = sets.map(set => dampen(set.length) / len);

function random_seq() {
	let r0 = Math.random();
	let r = r0;
	for (let i = 0; i < probs.length; i++) {
		r -= probs[i];
		if (r < 0) return random_choice(sets[i]); 
	}
	throw new Error('impossibru');
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

function name_need_norm(name) {
	try {
		let norm = ens_normalize(name);
		if (name != norm) {
			return name;
		}
	} catch (err) {		
	}
}
function name_error(name) {
	try {
		ens_normalize(name);
	} catch (err) {		
		return name;
	}
}

let names = [];
for (let fn of [name_need_norm, name_error]) {
	for (let n = 0; n < 10; n++) {
		names.push(...generate_random(100, 5 + n, fn));
	}
}

writeFileSync(join(base_dir, 'output/random-names.json'), JSON.stringify(names));