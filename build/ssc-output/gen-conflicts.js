import {join} from 'path';
import {readFileSync, writeFileSync} from 'fs';
import {read_parsed} from '../nodejs-utils.js';
import {parse_cp_range, parse_cp_sequence, compare_arrays, explode_cp, date_str} from '../utils.js';
import {nfc} from '../nf.js';


// get cp -> script mapping
const SCRIPTS = Object.entries(read_parsed('Scripts')).map(([k, v]) => [k, new Set(v.flatMap(parse_cp_range))]);
const ABBR_TO_SCRIPT = read_parsed('PropertyValueAliases').sc;
const SCRIPT_EXTS = Object.entries(read_parsed('ScriptExtensions')).map(([k, v]) => [
	new Set(parse_cp_range(k)), 
	v.map(abbr => {
		let script = ABBR_TO_SCRIPT[abbr];
		if (!script) throw new Error(`Unknown script abbr: ${abbr}`);
		return script;
	})
]);

//https://www.unicode.org/reports/tr39/#Mixed_Script_Detection
/*

    If Script_Extensions contains Hani (Han), add Hanb, Jpan, and Kore.
    If Script_Extensions contains Hira (Hiragana), add Jpan.
    If Script_Extensions contains Kana (Katakana), add Jpan.
    If Script_Extensions contains Hang (Hangul), add Kore.
    If Script_Extensions contains Bopo (Bopomofo), add Hanb.
*/

const SCRIPT_EXTRA = {
	'Hani': ['Hanb', 'Jpan', 'Kore'],
	'Hira': ['Jpan'],
	'Kana': ['Jpan'],
	'Hang': ['Kore'],
	'Bopo': ['Hanb']
};

const SCRIPT_MAP = {};
for (let [script, ranges] of Object.entries(read_parsed('Scripts'))) {
	for (let cp of ranges.flatMap(parse_cp_range)) {
		SCRIPT_MAP[cp] = new Set([script]);
	}
}
for (let [range, abbrs] of Object.entries(read_parsed('ScriptExtensions'))) {
	for (let cp of parse_cp_range(range)) {
		for (let abbr of abbrs) {



		}
	}
}





function script_from_cp(cp) {
	for (let [k, v] of SCRIPTS) {
		if (v.has(cp)) {
			return k;
		}
	}
}


let base_dir = new URL('.', import.meta.url).pathname;

// read valid output characters
let derived = JSON.parse(readFileSync(join(base_dir, '../output/release-1-hr.json')));
let valid_set = new Set(derived.valid);

// check that every output character has a script
let active = new Set();
for (let cp of valid_set) {
	let script = script_from_cp(cp);
	if (!script) {
		throw new Error(`Assumption wrong: output character without script: ${cp}`);
	}
	active.add(script);
}
// find active scripts
active.delete('Common');
active.delete('Inherited');	
active = [...active];

let db = {};
for (let [target, matches] of Object.entries(read_parsed('confusables'))) { // hex -> [hex hex]
	let map = {};
	let unique_forms = new Set();
	for (let hex of matches) {
		let cps = nfc(parse_cp_sequence(hex)); // convert to nfc
		let form = String.fromCodePoint(...cps);
		//if (is_unconfusable(form)) continue; 
		if (unique_forms.has(form)) continue; // already handled		
		unique_forms.add(form);
		if (!cps.every(cp => valid_set.has(cp))) continue; // not possible 
		let universe = cps.reduce((a, cp) => {
			let script = script_from_cp(cp);
			if (script === 'Inherited') return a;
			if (script === 'Common') {
				let exts = active;
				for (let [set, scripts] of SCRIPT_EXTS) {
					if (set.has(cp)) {
						exts = scripts;
						break;
					}
				}
				return a.flatMap(v => exts.map(x => [...v, x]));
			}
			return a.map(v => [...v, script]);
		}, [[]]);

		let single = new Set(universe.map(v => [...new Set(v)]).filter(x => x.length == 1).map(x => x[0]));



		for (let script of single) {
			let list = map[script];
			if (!list) map[script] = list = [];
			list.push([form, single.size]);
		}
	}
	let confuse = String.fromCodePoint(...parse_cp_sequence(target));
	for (let [script, list] of Object.entries(map)) {
		//if (list.length == 1) continue;
		let bucket = db[script];
		if (!bucket) db[script] = bucket = {};
		bucket[confuse] = list;
	}
}

writeFileSync(join(base_dir, 'conflicts.json'), JSON.stringify(db));

// dump latin
writeFileSync(join(base_dir, `conflicts-latin-${date_str()}.json`), JSON.stringify(db.Latin).replace(/\]\],/ug, ']],\n'));