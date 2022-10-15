// process: 
// 1. npm run derive
// 2. run this code
// 3. update confusable files
// 4. npm run derive (again)

import {UNICODE, SCRIPTS} from './unicode-version.js';
import {hex_cp} from './utils.js';
import {readFileSync, writeFileSync} from 'node:fs';
import {wholes_from_single} from './wholes.js';

//let out_dir = import.meta.url;
let rules_dir = new URL('./rules/', import.meta.url);

// dogfood: valid
let valid = new Set(JSON.parse(readFileSync(new URL('./output/spec.json', import.meta.url))).valid);

// dogfood: relaxed 
const common = SCRIPTS.require('Zyyy');
for (let cp of (await import('./rules/chars-common.js')).default) {
	for (let abbr of SCRIPTS.get_script_set(cp)) {
		SCRIPTS.require(abbr).set.delete(cp);
	}
	common.set.add(cp);
}

let abbr_order = ['Latn', 'Grek', 'Cyrl'];
let confusables = UNICODE.confusables();
for (let i = 1; i < abbr_order.length; i++) {
	let abbr = abbr_order[i];
	write_file(abbr, wholes_from_single(SCRIPTS, confusables, cp => valid.has(cp), abbr, abbr_order.slice(0, i)));
}

function write_file(name, m) {	
	let file = new URL(`./wholes-${name}.js`, rules_dir);
	let lines = [
		`// computed: ${new Date().toJSON()}`,
		`// version: ${UNICODE.version_str}`,
	];
	for (let {target, confused, matches} of m) {
		if (confused.length == 0) continue;
		lines.push(`// "${String.fromCodePoint(...target)}"`);
		for (let cps of matches) {
			lines.push(`// ${cps.map(cp => UNICODE.format(cp)).join(' + ')} (${[...SCRIPTS.get_script_set(cps)]})`);
		}
		for (let cp of confused) {
			lines.push(`0x${hex_cp(cp)}, // ${UNICODE.format(cp)}`);
		}
	}
	writeFileSync(file, [
		'export default [', 		
		...lines.map(s => '\t' + s), 
		']'
	].join('\n'));
	console.log(`Wrote: ${file.pathname}`);
}
