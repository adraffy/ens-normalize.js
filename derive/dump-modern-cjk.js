import {SCRIPTS} from './unicode-version.js';
//import {augment_script_set} from './unicode-logic.js';
import {readFileSync} from 'node:fs';

// dogfood: valid
let valid = new Set(JSON.parse(readFileSync(new URL('./output/spec.json', import.meta.url))).valid);

let abbrs = [
	'Hang', // Hangul
	'Hira', // Hiragan
	'Kana', // Katakana
	'Hani', // Hana
];

let buckets = {};
for (let abbr0 of abbrs) {
	let script = SCRIPTS.require(abbr0);
	for (let cp of script.set) {
		if (!valid.has(cp)) continue;
		for (let abbr of SCRIPTS.get_augmented_script_set(cp)) {
			let bucket = buckets[abbr];
			if (!bucket) {
				buckets[abbr] = bucket = new Set();
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
