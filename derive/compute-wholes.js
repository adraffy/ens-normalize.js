// process: 
// 1. npm run derive
// 2. run this code
// 3. update confusable files
// 4. npm run derive (again)

import {UNICODE, SCRIPTS} from './unicode-version.js';
import {hex_cp} from './utils.js';
import {writeFileSync} from 'node:fs';
import {wholes_from_single} from './wholes.js';
import {ORDERED_SCRIPTS, RESTRICTED_SCRIPTS, CHANGED_SCRIPTS} from './rules/scripts.js';
import SPEC from './output/spec.json' assert {type: 'json'};

let out_dir = new URL('./temp-wholes/', import.meta.url);
//let out_dir = new URL('./rules/', import.meta.url);

// dogfood: valid
let valid = new Set(SPEC.valid);

// dogfood: relaxed 
SCRIPTS.apply_changes(CHANGED_SCRIPTS);

const confusables = UNICODE.confusables();

/*
if (true) {
	let abbr = 'Hani';
	write_file(abbr, wholes_from_single(SCRIPTS, confusables, cp => valid.has(cp), abbr, [
		NAMED_SCRIPTS.slice(0, i),
		'Zyyy',
	].flat()));

}
*/

// compute confusables according to a priority
// 20221017: Latn has no wholes (start at 1)
let ordered = [...new Set(ORDERED_SCRIPTS.flatMap(x => x.test))];
for (let info of ORDERED_SCRIPTS) {
	let exclude = new Set(ordered);
	for (let abbr of info.test) {
		exclude.delete(abbr);
	}
	exclude = [...exclude];

	let wholes = info.test.flatMap(abbr => wholes_from_single(SCRIPTS, confusables, cp => valid.has(cp), abbr, exclude));
	write_file(info.name, wholes);
}

/*
// this is guarenteed by make.js
let ordered = [...new Set(ORDERED_SCRIPTS.flatMap(x => x.test))];
let unordered = new Set(SCRIPTS.entries.map(x => x.abbr));
ordered.forEach(x => unordered.delete(x));
RESTRICTED_SCRIPTS.forEach(x => unordered.delete(x));
unordered.delete('Zyyy');
unordered.delete('Zinh');
if (unordered.size) {
	console.log(unordered);
	throw new Error('unordered');
}
*/

/*
for (let i = 0; i < RESTRICTED_SCRIPTS.length; i++) {
	let abbr = RESTRICTED_SCRIPTS[i];
	write_file(abbr, wholes_from_single(SCRIPTS, confusables, cp => valid.has(cp), abbr, [
		ordered, 
		'Zyyy',
		RESTRICTED_SCRIPTS.slice(0, i), 
		// skip self
		RESTRICTED_SCRIPTS.slice(i+1)
	].flat()));
}
*/

function write_file(abbr, m) {	
	let file = new URL(`./wholes-${abbr}.js`, out_dir);
	let lines = [];
	for (let {target, confused, matches} of m) {
		if (!confused.length) continue;
		lines.push(`// "${String.fromCodePoint(...target)}"`);
		for (let cps of matches) {
			lines.push(`// ${cps.map(cp => UNICODE.format(cp)).join(' + ')} (${[...SCRIPTS.get_script_set(cps)]})`);
		}
		for (let cp of confused) {
			lines.push(`0x${hex_cp(cp)}, // ${UNICODE.format(cp)}`);
		}
	}
	if (lines.length == 0) {
		console.log(`No wholes: ${abbr}`);
		return;
	}
	writeFileSync(file, [
		`// created: ${new Date().toJSON()}`,
		`// version: ${UNICODE.version_str}`,
		'export default [', 		
		...lines.map(s => '\t' + s), 
		']'
	].join('\n'));
	console.log(`Wrote Wholes: ${abbr} (${lines.length})`);
}
