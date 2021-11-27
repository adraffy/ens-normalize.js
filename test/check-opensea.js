// compare known [label, hash] pairs to normalized

import {ens_normalize} from '../ens-normalize.js';
import {keccak} from '@adraffy/keccak';
import {readFileSync, writeFileSync} from 'fs';

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

function code_str(v) {
	return [...v].map(x => x.codePointAt(0).toString(16).padStart(2, '0')).join(' ');
}

let labels = JSON.parse(readFileSync(local_file('opensea-label-hash.json')));
let errors =  [];
let diffs = [];

for (let {label, hash} of labels) {
	try {
		let norm = ens_normalize(label);
		let norm_hash = keccak().update(norm).hex;
		if (norm_hash !== hash) {
			diffs.push({
				label: [label, code_str(label)], 
				norm: [norm, code_str(norm)]
			});
		}
	} catch (err) {
		errors.push({name, error: err.message});
	}
}

console.log({
	errors: errors.length,
	diffs: diffs.length
});

writeFileSync(local_file('output/opensea-errors.json'), JSON.stringify(errors));
writeFileSync(local_file('output/opensea-diffs.json'), JSON.stringify(diffs));