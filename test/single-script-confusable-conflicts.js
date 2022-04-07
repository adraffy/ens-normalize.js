
import LABELS from './registered-labels.js';

import {writeFileSync, mkdirSync} from 'fs';
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

function is_normalized(cps) {
	let tokens = ens_tokenize(String.fromCodePoint(...cps));
	return tokens.length == 1 && tokens[0].v;
}

function get_script_set(cps) {
	let set = new Set(cps.map(script_from_cp));
	set.delete('Common');
	set.delete('Inherited');
	return set;
}

let map = {};

for (let [target, matches] of Object.entries(read_parsed('confusables'))) {
	// target can be multiple characters
	// each match is always a single character

	let target_form = String.fromCodePoint(...parse_cp_sequence(target));

	let m = [target, ...matches].map(parse_cp_sequence);
	m = m.filter(is_normalized);
	m = group_by(m, v => [...get_script_set(v)].sort().join());	
	
	for (let [script, dups] of Object.entries(m)) {
		if (script && dups.length > 1) {
			let scr = map[script];
			if (!scr) map[script] = scr = {};
			scr[target_form] = dups.map(v => String.fromCodePoint(...v));
		}
	}
	
}

writeFileSync(join(output_dir, 'single-script-confusable-conflicts.json'), JSON.stringify(map));