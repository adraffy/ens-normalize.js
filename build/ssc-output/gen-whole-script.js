import {join} from 'path';
import {readFileSync, writeFileSync} from 'fs';
import {read_parsed} from '../nodejs-utils.js';
import {read_idna_rules, read_script_sets} from '../unicode-logic.js';
import {map_values, parse_cp_sequence, date_str, hex_cp, set_intersect} from '../utils.js';
import {nfc} from '../nf.js';

let base_dir = new URL('.', import.meta.url).pathname;

//let derived = JSON.parse(readFileSync(join(base_dir, '../output/v2-hr.json')));
//let valid_set = new Set(derived.valid);

let {valid} = read_idna_rules({version: 2008});
valid = new Set(valid);

let {ALL, ...scripts} = map_values(read_script_sets({level: 3, remove_subsets: true}), cps => set_intersect(cps, valid)); 

throw 1;

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
	let name = String.fromCodePoint(...parse_cp_sequence(confuse));	
	let unique_forms = new Set();
	for (let hex of [confuse, ...matches]) {
		let cps0 = parse_cp_sequence(hex);
		let cps = nfc(cps0); // convert to nfc
		if (!cps.every(cp => valid.has(cp))) continue; // not possible 
		let form = String.fromCodePoint(...cps); 
		if (unique_forms.has(form)) continue; // already handled
		unique_forms.add(form);
		let universe = compute_script_universe(cps);
		if (universe.length == 0) {
			if (hex !== confuse) throw new Error('wtf');
			//console.log(String.fromCodePoint(...cps0), hex, cps.map(hex_cp).join(' '));
			continue; // not single script
		} else if (universe.length != 1) {
			console.log(String.fromCodePoint(...cps0), hex, cps.map(hex_cp).join(' '), universe);
		}
	}
}

//writeFileSync(join(base_dir, 'conflicts3.json'), JSON.stringify(db));

// dump latin
//writeFileSync(join(base_dir, `conflicts-Latn-${date_str()}.json`), JSON.stringify(db.Latn).replace(/\]\],/ug, ']],\n'));