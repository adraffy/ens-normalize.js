
import {read_parsed} from '../nodejs-utils.js';
import {parse_cp_range, parse_cp, parse_cp_sequence, compare_arrays, explode_cp, date_str} from '../utils.js';
import {Encoder} from '../encoder.js';

//https://www.unicode.org/reports/tr39/#Mixed_Script_Detection
/*
If Script_Extensions contains Hani (Han), add Hanb, Jpan, and Kore.
If Script_Extensions contains Hira (Hiragana), add Jpan.
If Script_Extensions contains Kana (Katakana), add Jpan.
If Script_Extensions contains Hang (Hangul), add Kore.
If Script_Extensions contains Bopo (Bopomofo), add Hanb.
*/
const SCRIPT_EXT_TR39 = {
	'Hani': ['Hanb', 'Jpan', 'Kore'],
	'Hira': ['Jpan'],
	'Kana': ['Jpan'],
	'Hang': ['Kore'],
	'Bopo': ['Hanb']
};

const ALL = '__raffy';

const NAME_TO_ABBR = Object.fromEntries(Object.entries(read_parsed('PropertyValueAliases').sc).map(v => v.reverse()));

let cp_to_abbr = {};
for (let [script, ranges] of Object.entries(read_parsed('Scripts'))) {
	let abbr;
	if (script === 'Common' || script === 'Inherited') {
		abbr = ALL;
	} else {
		abbr = NAME_TO_ABBR[script];
		if (!abbr) throw new Error(`Assumption: unknown script: ${script}`);
	}
	for (let cp of ranges.flatMap(parse_cp_range)) {
		cp_to_abbr[cp] = abbr;
	}
}

for (let [range, abbrs] of Object.entries(read_parsed('ScriptExtensions'))) {
	abbrs = new Set(abbrs);
	for (let [x, ys] of Object.entries(SCRIPT_EXT_TR39)) {
		if (abbrs.has(x)) {
			for (let x of ys) abbrs.add(x);
		}
	} 
	abbrs = [...abbrs];
	for (let cp of parse_cp_range(range)) {
		let old = cp_to_abbr[cp];
		if (!old) throw new Error(`Assumption: missing script: ${cp}`);
		if (typeof old !== 'string') throw new Error(`Assumption: duplicate: ${cp}`);
		if (old !== ALL && !abbrs.includes(old)) throw new Error(`Assumption: disunion: ${cp}`);
		cp_to_abbr[cp] = abbrs;
	}
}


//console.log(cp_to_abbr[20491]);

for (let cp of explode_cp('うずまきナルト')) {
	console.log(cp, cp_to_abbr[cp]);
}


let abbr_to_cps = {};
for (let [cp, v] of Object.entries(cp_to_abbr)) {
	if (typeof v === 'string') v = [v];
	cp = parseInt(cp);
	for (let script of v) {
		let list = abbr_to_cps[script];
		if (!list) abbr_to_cps[script] = list = [];		
		list.push(cp);
	}
}


/*
let base = abbr_to_cps.Jpan;
for (let a of 'Bopo Hang Hani Hira Kana Yiii'.split(' ')) {
	let cps = abbr_to_cps[a].filter(cp => !base.includes(cp));
	console.log(a, cps);
}
*/


/*
console.log(Object.keys(abbr_to_cps).length);



//delete abbr_to_cps[ALL];

let enc = new Encoder();
for (let [script, cps] of Object.entries(abbr_to_cps)) {
	enc.write_member(cps);
}
console.log(enc.compressed().length);
*/