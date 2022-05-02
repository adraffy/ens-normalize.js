import {readFileSync} from 'fs';
import {join} from 'path';
import {explode_cp} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

let lengths = {};

for (let [script, confuse] of Object.entries(JSON.parse(readFileSync(join(base_dir, 'output/single-script-confusable-conflicts.json'))))) {
	for (let [name, matches] of Object.entries(confuse)) {
		for (let s of matches) {
			let cps = explode_cp(s);
			lengths[cps.length] = (lengths[cps.length] ?? 0) + 1; 
		}
	}
}
console.log(lengths);