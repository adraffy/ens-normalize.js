import {group_by, parse_cp_range} from '../utils.js';
import {read_parsed} from '../nodejs-utils.js';
import {writeFileSync} from 'fs';
import {join} from 'path';


const base_dir = new URL('.', import.meta.url).pathname;
const Names = read_parsed('Names');
const {Common, Latin, Greek, Cyrillic} = read_parsed('Scripts');


let buckets = {};
for (let script of [Common, Latin, Greek, Cyrillic]) {
	for (let cp of script.flatMap(parse_cp_range)) {
		let name = Names[cp];
		if (/\b[A-Z]\b/.test(name)) {
			let key = name.replace(/(\b)[A-Z](\b)/, (_, a, b) => `${a}$${b}`);
			let bucket = buckets[key];
			if (!bucket) buckets[key] = bucket = [];
			bucket.push([name, cp]);
		}
	}
}

writeFileSync('./letter-patterns.json', JSON.stringify(Object.keys(buckets), null, 2));