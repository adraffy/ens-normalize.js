import {ens_normalize} from '../ens-normalize.js';
import {nameprep} from '@ethersproject/strings';
import {readFileSync, writeFileSync} from 'fs';

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

let errors = [];
let diffs = [];
let labels = readFileSync(local_file('../old/eth-labels-20211127-134810-rx6ulbdm52rz.csv'), {encoding: 'utf8'}).split('\n');
for (let label of labels) {
    let norm0;
    try {
        norm0 = nameprep(label);
    } catch (err) {
        continue;
    }
	try {
		let norm = ens_normalize(label);        
		if (norm != norm0) {
			diffs.push({label, nameprep: norm0, adraffy: norm});
		}
	} catch (err) {
		errors.push({label, nameprep: norm0, adraffy: err.message})
	}
}

writeFileSync(local_file('output/nameprep.json'), JSON.stringify({errors, diffs}));