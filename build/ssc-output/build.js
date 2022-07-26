
import {join} from 'path';
import {readFileSync, writeFileSync} from 'fs';
import {explode_cp} from '../utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

let conflicts = JSON.parse(readFileSync(join(base_dir, 'conflicts.json')));

let resolved = {...conflicts};
resolved.Latn = JSON.parse(readFileSync(join(base_dir, 'conflicts-Latn-20220515.json')));


let confused = {};

for (let [script, map] of Object.entries(conflicts)) {
	for (let [confuse, matches] of Object.entries(map)) {
		for (let [s, n] of matches) {
			let states = confused[s];


			if (!states) confused[s] = states = [];
			let state = resolved[script]?.[confuse]?.includes(s);
			states.push([script, state]);
		}
	}
}

// get all of confusables that are disallowed in every script they appear
let global_set = new Set(Object.entries(confused).filter(([_, states]) => {
	return states.length > 1 && states.every(([_, dis]) => dis);
}).map(([s]) => s));


let global = new Set();
let per_script = {};

for (let [script, map] of Object.entries(resolved)) {
	for (let [confuse, matches] of Object.entries(map)) {
		for (let s of matches) {
			if (global_set.has(s)) {
				global.add(s);
			} else {
				let set = per_script[script];
				if (!set) per_script[script] = set = new Set();		
				set.add(s);
			}
		}
	}
}

console.log(global.size)
console.log(Object.entries(per_script).map(([k, set]) => {
	let m = [...set].map(explode_cp);
	let solo = m.filter(v => v.length == 1);
	let multi = m.filter(v => v.length > 1);
	return [k, solo.length, multi.length];
}));

console.log(per_script.Latin);