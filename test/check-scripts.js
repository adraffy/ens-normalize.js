
import {writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {map_values, parse_cp_range, set_intersect, split_between} from '../build/utils.js';

import {read_parsed} from '../build/nodejs-utils.js';
import {ens_tokenize} from '../index.js';
import LABELS from './registered-labels.js';

let base_dir = new URL('.', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');
mkdirSync(output_dir, {recursive: true});

const SCRIPTS = Object.entries(map_values(read_parsed('Scripts'), v => new Set(v.flatMap(parse_cp_range))));

/*
for (let i = 0; i < SCRIPTS.length; i++) {
	for (let j = i + 1; j < SCRIPTS.length; j++) {
		let set = set_intersect(SCRIPTS[i][1], SCRIPTS[j][1]);
		if (set.size > 0) {
			throw new Error(`Assumption wrong: overlap ${i} ${j}`);
		}
	}
}
*/

function script_from_cp(cp) {
	for (let [k, v] of SCRIPTS) {
		if (v.has(cp)) {
			return k;
		}
	}
	throw new Error(`unknown script: ${cp}`);
}

let tally_unsorted = {};
let tally_sorted = {};
let tally_count = {};
for (let label of LABELS) {
	let tokens = ens_tokenize(label);
	let scripts = tokens.flatMap(t => {
		if (t.e) return 'Emoji';
		let v = t.v ?? t.m;
		if (v) return v.map(script_from_cp);
		if ('d' in t) return script_from_cp(t.d);
		return [];
	});
	scripts = split_between(scripts, (a, b) => a !== b).map(v => v[0]);

	let set = new Set(scripts);

	// unsorted
	let unsorted = scripts.join(',');
	tally_unsorted[unsorted] = (tally_unsorted[unsorted] ?? 0) + 1;

	// sorted
	let sorted = [...set].sort((a, b) => a.localeCompare(b)).join(',');
	tally_sorted[sorted] = (tally_sorted[sorted] ?? 0) + 1;

	// tally
	for (let key of scripts) {
		tally_count[key] = (tally_count[key] ?? 0) + 1;
	}
}

writeFileSync(join(output_dir, 'script-tally-unsorted.json'), JSON.stringify(tally_unsorted));
writeFileSync(join(output_dir, 'script-tally-sorted.json'), JSON.stringify(tally_sorted));
writeFileSync(join(output_dir, 'script-tally-count.json'), JSON.stringify(tally_count));