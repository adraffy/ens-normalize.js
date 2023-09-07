// WIP
// compare two unicode versions AFTER parsing

import {UnicodeSpec} from './unicode-logic.js';
import {ens_idna_rules} from './idna.js'; 
import {hex_cp} from './utils.js';
import assert from 'node:assert/strict';

const UNICODE0 = new UnicodeSpec(new URL('./data/15.0.0/', import.meta.url), new URL('./data/CLDR-42/', import.meta.url));
const UNICODE1 = new UnicodeSpec(new URL('./data/15.1.0/', import.meta.url), new URL('./data/CLDR-43.1/', import.meta.url));

const IDNA0 = ens_idna_rules(UNICODE0);
const IDNA1 = ens_idna_rules(UNICODE1);

/*
for (let abbr of new Set([...UNICODE0.script_map.keys(), ...UNICODE1.script_map.keys()])) {
	let script0 = UNICODE0.script_map.get(abbr);
	let script1 = UNICODE1.script_map.get(abbr);
	if (!script0 || !script1) throw new Error(`wtf script: ${abbr}`);
	for (let cp of new Set([...script0.map.keys(), ...script1.map.keys()])) {
		let char0 = script0.map.get(cp);
		let char1 = script1.map.get(cp);
		if (char0 && char1) {
			//			
		} else if (char0) {
			throw new Error(`wtf char: ${cp}`);
		} else {
			console.log(`New Char: ${JSON.stringify(char1)}`);
		}
	}
}
*/

console.log('idna.valid');
quick_diff(IDNA0.valid, IDNA1.valid);
console.log('idna.ignored');
quick_diff(IDNA0.ignored, IDNA1.ignored);
console.log('idna.mapped');
quick_diff(IDNA0.mapped, IDNA1.mapped);

// TODO: add more
console.log('read_composition_exclusions');
quick_diff(UNICODE0.read_composition_exclusions(), UNICODE1.read_composition_exclusions());

console.log('read_short_names()');
quick_diff(UNICODE0.read_short_names(), UNICODE1.read_short_names());
console.log('read_regions()');
quick_diff(UNICODE0.read_regions(), UNICODE1.read_regions());

// TODO: replace with proper deep diff

function quick_diff(a, b) {
	a = quick_diff_rep(a);
	b = quick_diff_rep(b);

	let a_minus_b = new Set(a);
	for (let x of b) a_minus_b.delete(x);

	let b_minus_a = new Set(b);
	for (let x of a) b_minus_a.delete(x);
	
	if (a_minus_b.size == 0 && b_minus_a.size == 0) {
		console.log('Same');
	} else {
		console.log('Added:', [...b_minus_a]);
		console.log('Removed:', [...a_minus_b]);
	}
}

function quick_diff_rep(obj) {
	if (Array.isArray(obj)) {
		return obj.map(x => {
			if (typeof x === 'object') {
				return JSON.stringify(x);
			} else {
				return x;
			}
		});
	} else if (obj instanceof Map || obj instanceof Set) {
		return obj;
	} else {
		return quick_diff_rep(Object.entries(obj));
	}

}
