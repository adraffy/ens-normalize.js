import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {parse_cp_sequence, hex_cp} from '../utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

let groups = JSON.parse(readFileSync(join(base_dir, '../output/confusable-groups.json')));

let found = [];

for (let group of groups) {
	for (let hex of group) {
		let cps = parse_cp_sequence(hex);
		let i = cps.indexOf(0xB7);
		if (i == -1) continue;
		//if (cps[i - 1] == 0x6C && cps[i+1] === 0x6C) continue; 
		found.push(cps);
	}
}

console.log(JSON.stringify(found.sort(), null, 2));

/*
writeFileSync(join(base_dir, '../rules/confusable-middle-dot.js'), [
	`// generated: ${new Date().toJSON()}`,
	`export default [`,
	...found.map(v => `'${v.map(hex_cp).join(' ')}', // ${String.fromCodePoint(...v)}`),
	'];'
].join('\n'));
*/