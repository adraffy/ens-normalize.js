// scan list of non-ascii labels
// find errors and diffs

import {ens_normalize} from '../ens-normalize.js';
import {readFileSync, writeFileSync} from 'fs';

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

function code_str(v) {
	return [...v].map(x => x.codePointAt(0).toString(16).padStart(2, '0')).join(' ');
}

let labels = readFileSync(local_file('goofy-labels.txt'), {encoding: 'utf8'}).split('\n');
let errors = [];
let diffs = [];

for (let label of labels) {
	try {
		let norm = ens_normalize(label);
		if (norm != label) {
			diffs.push({
				label: [label, code_str(label)], 
				norm: [norm, code_str(norm)]
			});
		}
	} catch (err) {
		errors.push({label, error: err.message});
	}
}

console.log({
	errors: errors.length,
	diffs: diffs.length
});

writeFileSync(local_file('output/goofy-errors.json'), JSON.stringify(errors));
writeFileSync(local_file('output/goofy-diffs.json'), JSON.stringify(diffs));



