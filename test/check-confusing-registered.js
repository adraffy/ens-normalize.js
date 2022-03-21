// compute the before and after scripts for NFC
// warning: this only tests the provided examples


import LABELS from './registered-labels.js';

//import {readFileSync, writeFileSync, mkdirSync} from 'fs';
//import {join} from 'path';

import {ens_normalize} from '../dist/ens-normalize.js';
import {explode_cp, map_values, parse_cp_range, parse_cp, group_by} from '../build/utils.js';
import {read_parsed} from '../build/nodejs-utils.js';

const SCRIPTS = Object.entries(map_values(read_parsed('Scripts'), v => new Set(v.flatMap(parse_cp_range))));

function script_from_cp(cp) {
	for (let [k, v] of SCRIPTS) {
		if (v.has(cp)) {
			return k;
		}
	}
	return 'Unknown';
}

// construct confusable map per script
let confusables = {};
for (let [group, cps] of Object.entries(read_parsed('confusables'))) {
	if (!cps.includes(group)) {
		cps.push(group); // include the name
	}
	cps = cps.map(parse_cp);
	cps = cps.filter(cp => {
		try {
			ens_normalize(String.fromCodePoint(cp));
			return true;
		} catch (e) {
			return false;
		}
	});
	for (let [script, v] of Object.entries(group_by(cps, script_from_cp))) {
		if (v.length > 1) {
			let map = confusables[script];
			if (!map) confusables[script] = map = {};
			for (let cp of v) {
				let ch = map[cp];
				if (!ch) map[cp] = ch = [];
				ch.push([group, v.length]);
			}
		}
	}
}

let tally = {};
for (let label of LABELS) { //[...LABELS].slice(0, 1000)) {
	let norm;
	try {
		norm = ens_normalize(label);
	} catch (err) {
		continue;
	}
	let cps = explode_cp(norm);
	let scripts = cps.map(script_from_cp);
	let set = new Set(scripts);
	if (set.size > 1) set.delete('Common');
	if (set.size > 1) continue;	
	let script0 = [...set][0];
	let rec = tally[script0];
	if (!rec) tally[script0] = rec = {pure: 0, safe: 0}; //, confused: []};
	rec.pure++;
	let map = confusables[script0];
	if (!map) {
		rec.safe++;
		continue;
	}
	//console.log(norm);
	//console.log(cps.map(x => map[x]));
	let product = 1n;
	for (let cp of cps) {	
		let ch = map[cp];
		if (!ch) continue;
		product *= BigInt(ch.reduce((a, [_, n]) => a + n, 0));
	}
	if (product > 1n) {
		//rec.confused.push(product);
	} else {
		rec.safe++;
	}
}

console.log(tally);