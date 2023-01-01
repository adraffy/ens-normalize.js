// compute augmented cjk containment

import {UNICODE} from './unicode-version.js';
import {readFileSync} from 'node:fs';

const SPEC = JSON.parse(readFileSync(new URL('./output/spec.json', import.meta.url))); // note: requires spec

let valid = new Set(SPEC.groups.flatMap(g => [...g.primary, ...g.secondary]));

let abbrs = [
	'Hang', // Hangul
	'Hira', // Hiragan
	'Kana', // Katakana
	'Hani', // Hana
];

let buckets = {};
for (let abbr0 of abbrs) {
	let script0 = UNICODE.require_script(abbr0);
	for (let cp of script0.map.keys()) {
		if (!valid.has(cp)) continue;
		for (let script of UNICODE.get_augmented_script_set(cp)) {
			let key = script.abbr;
			let bucket = buckets[key];
			if (!bucket) {
				buckets[key] = bucket = new Set();
			}
			bucket.add(cp);
		}
	}
}

buckets = Object.entries(buckets);
for (let [abbr, set] of buckets) {
	console.log(`${abbr} (${set.size})`);
}

for (let i = 1; i < buckets.length; i++) {
	let [abbr_i, set_i] = buckets[i];
	for (let j = 0; j < i; j++) {
		let [abbr_j, set_j] = buckets[j];
		let i_j = [...set_i].every(x => set_j.has(x));
		let j_i = [...set_j].every(x => set_i.has(x));
		if (i_j && j_i) {
			console.log(`${abbr_i} == ${abbr_j}`);
		} else if (i_j) {
			console.log(`${abbr_i} contains ${abbr_j}`);
		} else {
			console.log(`${abbr_j} contains ${abbr_i}`);
		}
	}
}
