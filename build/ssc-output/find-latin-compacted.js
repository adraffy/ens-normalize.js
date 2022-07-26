import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {parse_cp_sequence, hex_cp} from '../utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

let groups = JSON.parse(readFileSync(join(base_dir, '../output/confusable-groups.json')));

let found = [];

let regex = /^[a-z]+$/i;

for (let group of groups) {
	for (let hex of group) {
		let cps = parse_cp_sequence(hex);
	
	}
}

console.log(JSON.stringify(found.sort(), null, 2));