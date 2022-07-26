import {join} from 'path';
import {readFileSync, writeFileSync} from 'fs';
import {read_parsed} from '../nodejs-utils.js';
import {read_idna_rules, read_script_sets, RECOMMENDED_SCRIPTS} from '../unicode-logic.js';
import {map_values, subsets, parse_cp_sequence, date_str, hex_cp, set_intersect, compare_arrays, set_complement} from '../utils.js';
import {nfc} from '../nf.js';

let base_dir = new URL('.', import.meta.url).pathname;

let {valid} = read_idna_rules({version: 2008});
valid = new Set(valid);

let {ALL, ...scripts} = map_values(read_script_sets({level: 3, remove_subsets: false}), cps => set_intersect(cps, valid)); 

let all_abbrs = Object.keys(scripts);

function compute_script_universe(cps) {
	let ret = all_abbrs;
	for (let cp of cps) {
		if (ALL.has(cp)) continue;
		ret = ret.filter(k => scripts[k].has(cp));
		if (ret.length == 0) break;		
	}
	return ret;
}

let db = {};
for (let [confuse, matches] of Object.entries(read_parsed('confusables'))) { // hex -> [hex hex]
	confuse = parse_cp_sequence(confuse);
	matches = matches.map(parse_cp_sequence);
	let name = String.fromCodePoint(...confuse);	
	let unique = new Set();
	let map = {};
	for (let cps0 of [confuse, ...matches]) {
		let cps = nfc(cps0); // convert to nfc
		if (!cps.every(cp => valid.has(cp))) continue; // not possible 
		let form = String.fromCodePoint(...cps); 
		if (unique.has(form)) continue; // already handled
		unique.add(form);
		let universe = compute_script_universe(cps);
		if (universe.length == 0) {
			if (compare_arrays(confuse, cps0)) throw new Error('wtf');
			continue; // not single script
		}
		if (universe.length == all_abbrs.length) continue;

		for (let abbr of universe) {
			let bucket = map[abbr];
			if (!bucket) map[abbr] = bucket = [];
			bucket.push(cps);
		}
	}
	db[name] = map;
}

for (let [confuse, map] of Object.entries(db)) {
	let {Latn} = map;
	if (!Latn || Latn.length == 1) continue;
	console.log(Latn.map(x => String.fromCodePoint(...x)));
}

/*

let set = new Set();

for (let [abbr1, abbr2] of subsets(set_complement(RECOMMENDED_SCRIPTS, ['Zyyy', 'Zinh']), 2)) {
	let found = [];
	for (let [confuse, map] of Object.entries(db)) {
		if (map[abbr1] && map[abbr2]) {
			let v1 = map[abbr1].map(x => String.fromCodePoint(...x));
			let v2 = map[abbr2].map(x => String.fromCodePoint(...x));
			found.push([confuse, v1, v2]);
			if (abbr1 != 'Latn') {
				for (let x of v1) {
					set.add(x);
				}
			}
			if (abbr2 != 'Latn') {
				for (let x of v2) {
					set.add(x);
				}
			}
		}
	}
	if (found.length > 0) {
		console.log(abbr1, abbr2);
		console.log(found);
	}
}

console.log(set);

console.log(set.size);
*/

//writeFileSync(join(base_dir, 'conflicts4.json'), JSON.stringify(db));

// dump latin
//writeFileSync(join(base_dir, `conflicts-Latn-${date_str()}.json`), JSON.stringify(db.Latn).replace(/\]\],/ug, ']],\n'));