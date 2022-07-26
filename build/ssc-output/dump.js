import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {read_script_sets} from '../unicode-logic.js';
import {parse_cp_sequence, explode_cp, set_intersect, map_values, subsets, hex_cp} from '../utils.js';
import {rules_for_adraffy} from '../rules.js';
import {read_confusable_sets} from './unicode-logic.js';

let base_dir = new URL('.', import.meta.url).pathname;

let {idna} = await rules_for_adraffy();
idna.extract_stops();


let {ALL, ...abbr_to_set} = map_values(read_script_sets({level: 3}), set => set_intersect(set, idna.VALID));
let all_abbrs = Object.keys(abbr_to_set);

/*
console.log(abbr_to_set['Jpan'].has(0x30FB));
console.log(compute_script_universe([0x30FB]));
throw 1;
*/

function compute_script_universe(cps) {
	let ret = all_abbrs;
	for (let cp of cps) {
		if (ALL.has(cp)) continue;
		ret = ret.filter(k => abbr_to_set[k].has(cp));
		if (ret.length == 0) break;		
	}
	return ret;
}

let allowed_global = new Set((await import('../rules/confusables-global.js')).default.map(s => {
	return String.fromCodePoint(...parse_cp_sequence(s));
}));

let allowed_local = new Set((await import('../rules/confusables-local.js')).default.map(s => {
	return String.fromCodePoint(...parse_cp_sequence(s));
}));

let regex = /^[0-9a-z\-]+$/i;
let groups = [];
for (let set of read_confusable_sets()) {
	let group = [];
	for (let form of set) {
		let cps = explode_cp(form);
		let uni = compute_script_universe(cps);
		if (uni.length == 0) continue;
		if (cps.includes(0xB7)) continue; // middle dot
		let ty = 'C';
		if (regex.test(form) || allowed_global.has(form)) {
			ty = 'G';
		} else if (allowed_local.has(form)) {
			ty = 'L';
		}
		group.push({hex: cps.map(hex_cp).join(' '), form, uni, ty});
	}
	if (group.length > 1) {
		groups.push(group);
	} 
}

writeFileSync(join(base_dir, '../output/groups.json'), JSON.stringify(groups, null, 2));

let whole = [];
for (let group0 of groups) {
	let group = group0.filter(x => x.ty != 'G');
	for (let [a, b] of subsets(group, 2)) {
		if (set_intersect(a.uni, b.uni).size == 0) {
			whole.push(...group.map(x => x.form));
			break;
		}
	}
}


let per = {};

/*
for (let group0 of groups) {
	let group_all = group0.filter(x => x.uni.length == all_abbrs.length);
	let group_sub = group0.filter(x => x.uni.length < all_abbrs.length);
	for (let abbr of all_abbrs) {
		let group_abbr = group_sub.filter(x => x.uni.includes(abbr));
		if (group_all.length + group_abbr.length < 2) continue;
		let group = [...group_all, ...group_abbr].filter(x => x.confusing);
		if (group.length == 0) continue;
		let bucket = per[abbr];
		if (!bucket) per[abbr] = bucket = new Set();
		group.forEach(x => bucket.add(x.form));
	}
}
*/

for (let group0 of groups) {
	for (let abbr of all_abbrs) {
		let group = group0.filter(x => x.uni.includes(abbr));
		if (group.length < 2) continue;
		group = group.filter(x => x.ty == 'C');
		if (group.length == 0) continue;
		let bucket = per[abbr];
		if (!bucket) per[abbr] = bucket = new Set();
		group.forEach(x => bucket.add(x.form));
	}
}

let global = set_intersect(...Object.values(per));
for (let [k, set] of Object.entries(per)) {
	for (let x of global) {
		set.delete(x);
	}
	if (set.size == 0) {
		delete per[k];
	}
}

writeFileSync(join(base_dir, '../output/confusing.json'), JSON.stringify({whole, global, per}, (_, v) => {
	if (v instanceof Set) v = [...v];
	return v;	
}));
