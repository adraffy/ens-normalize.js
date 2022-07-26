import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {parse_cp_sequence, hex_cp} from '../utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

let groups = JSON.parse(readFileSync(join(base_dir, '../output/confusable-groups.json')));

let found = [];

let regex = /^[a-z-]+$/i;

for (let group of groups) {
	for (let hex of group) {
		let cps = parse_cp_sequence(hex);
		let form = String.fromCodePoint(...cps);
		//if (cps.every(cp => cp < 0x80)) {
		if (regex.test(form)) {
			found.push(cps);
		}
	}
}

//console.log(JSON.stringify(found.sort(), null, 2));

writeFileSync(join(base_dir, '../rules/confusable-ascii.js'), [
	`// generated: ${new Date().toJSON()}`,
	`export default [`,
	...found.map(v => `\t'${v.map(hex_cp).join(' ')}', // ${String.fromCodePoint(...v)}`),
	'];'
].join('\n'));