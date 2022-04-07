
import LABELS from './registered-labels.js';

import {writeFileSync, mkdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {ens_normalize, ens_tokenize} from '../dist/ens-normalize.js';
import {explode_cp, map_values, parse_cp_range, parse_cp_sequence, parse_cp, group_by} from '../build/utils.js';
import {read_parsed} from '../build/nodejs-utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');
mkdirSync(output_dir, {recursive: true});

const SCRIPTS = Object.entries(map_values(read_parsed('Scripts'), v => new Set(v.flatMap(parse_cp_range))));
function script_from_cp(cp) {
	for (let [k, v] of SCRIPTS) {
		if (v.has(cp)) {
			return k;
		}
	}
	return 'Unknown';
}
function get_script_set(cps) {
	let set = new Set(cps.map(script_from_cp));
	set.delete('Common');
	set.delete('Inherited');
	return set;
}

let SCRIPT_CONFLICTS = JSON.parse(readFileSync(join(output_dir, 'single-script-confusable-conflicts.json')));

SCRIPT_CONFLICTS = map_values(SCRIPT_CONFLICTS, map => map_values(map, matches => ({matches})));

// load canonical choices
let {Latin} = SCRIPT_CONFLICTS;
for (let [key, v] of Object.entries(JSON.parse(readFileSync(join(base_dir, 'data', 'confusable-canonical-latin-20220406.json'))))) {
	if (v.length == 0) { 
		// if we deleted it, it was stupid
		delete Latin[key];
		continue;
	} 
	if (v.length == 1) {
		// if we reduced it, its canonical
		Latin[key].canonical = v[0];	
	}
}

SCRIPT_CONFLICTS = map_values(SCRIPT_CONFLICTS, map => {
	let confusing = {};
	for (let [confuse, {matches, canonical}] of Object.entries(map)) {
		for (let x of matches) {
			if (x === canonical) continue;
			confusing[x] = confuse;
		}	
	}
	return confusing;
});

let SCRIPT_MAX = map_values(SCRIPT_CONFLICTS, v => Math.max(...Object.keys(v).map(x => x.length)));

let not_norm = 0;
let not_single_script = 0;
let no_primary_script = [];
let per_script = {};

if (true) {
	console.log(LABELS.size);
	throw 1;
}

for (let label of LABELS) {
	
	let norm;
	try {
		norm = ens_normalize(label);
	} catch (ignored) {		
		not_norm++;
		continue;
	}
	
	let norm_cps = explode_cp(norm);
	let scripts = get_script_set(norm_cps);	
	if (scripts.size > 1) {
		not_single_script++;
		continue;
	} else if (scripts.size == 0) {
		no_primary_script.push(label);
		continue;
	}
	let script = [...scripts][0];

	let max = SCRIPT_MAX[script];
	if (!max) {
		continue; 
	}
	let conflicts = SCRIPT_CONFLICTS[script];

	let errors = [];
	for (let token of ens_tokenize(norm)) { // should be only e or v or (sep)
		let {v, e} = token;
		if (e) continue; 
		if (!v) continue; // separator
 		for (let n = 1; n <= max; n++) {
			for (let i = n; i < v.length; i++) {
				let cps = v.slice(i-n, i);
				let form = String.fromCodePoint(...cps);
				let conflict = conflicts[form];
				if (!conflict) continue;
				errors.push([i, n, conflict]);
			} 
		}
	}

	let results = per_script[script];
	if (!results) per_script[script] = results = {valid: [], errors: []};

	if (errors.length == 0) {		
		results.valid.push(label);
	} else {
		results.errors.push([label, errors]);
	}
}

writeFileSync(join(output_dir, 'single-script-confusable-labels.json'), JSON.stringify({
	not_norm,
	not_single_script,
	no_primary_script,
	per_script
}));