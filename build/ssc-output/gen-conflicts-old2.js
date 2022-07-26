import {join} from 'path';
import {readFileSync, writeFileSync} from 'fs';
import {read_parsed} from '../nodejs-utils.js';
import {read_script_sets} from '../unicode-logic.js';
import {map_values, parse_cp_sequence, date_str, hex_cp} from '../utils.js';
import {nfc} from '../nf.js';

let base_dir = new URL('.', import.meta.url).pathname;

let derived = JSON.parse(readFileSync(join(base_dir, '../output/v2-hr.json')));
let valid_set = new Set(derived.valid);

let {ALL, ...scripts} = map_values(read_script_sets(), cps => new Set(cps.filter(cp => valid_set.has(cp)))); 
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
	//let map = {};
	matches = matches.map(parse_cp_sequence);
	confuse = String.fromCodePoint(...parse_cp_sequence(confuse));
	let unique_forms = new Set();
	for (let cps0 of matches) {
		let cps = nfc(cps0); // convert to nfc
		if (Math.max(...cps) < 0x80) continue; // ignore ascii
		if (!cps.every(cp => valid_set.has(cp))) continue; // not possible 
		let form = String.fromCodePoint(...cps);
		if (unique_forms.has(form)) continue; // already handled		
		unique_forms.add(form);
		let universe = compute_script_universe(cps);
		if (universe.length == 0) {
			console.log(form);
			continue; // not single script
		}
		if (universe.length === all_abbrs.length) universe = ['ALL'];
 		
		for (let script of universe) {
			let bucket = db[confuse];
			if (!bucket) db[confuse] = bucket = [];
			bucket.push([cps.map(hex_cp).join(' '), form, script]);
		}
	}
}

writeFileSync(join(base_dir, 'conflicts2.json'), JSON.stringify(db));

// dump latin
//writeFileSync(join(base_dir, `conflicts-Latn-${date_str()}.json`), JSON.stringify(db.Latn).replace(/\]\],/ug, ']],\n'));