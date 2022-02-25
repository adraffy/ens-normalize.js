import {group_by, parse_cp_range} from '../utils.js';
import {read_parsed} from '../nodejs-utils.js';
import {writeFileSync} from 'fs';
import {join} from 'path';


const base_dir = new URL('.', import.meta.url).pathname;
const Names = read_parsed('Names');
const {Common, Latin, Greek, Cyrillic} = read_parsed('Scripts');

let filtered = {};
for (let script of [Common, Latin, Greek, Cyrillic]) {
	for (let cp of script.flatMap(parse_cp_range)) {
		filtered[cp] = Names[cp];
	}
}

import EMOJI_SET from './emoji-post-idna.js';
for (let cp of EMOJI_SET) {
	delete filtered[cp];
}

let grouped = Object.values(group_by(Object.entries(filtered), ([_, name]) => name));
//console.log(grouped.filter(v => v.length > 1));
//writeFileSync(join(base_dir, 'dup.json'), JSON.stringify(grouped.filter(v => v.length > 1)));

// construct unique-only reverse mapping
const REV_NAMES = Object.fromEntries(grouped.filter(v => v.length === 1).map(([[k, v]]) => [v, parseInt(k)]));

// replacements
const MAPPING_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((x, i) => [x, i]); // StringJoin@CharacterRange["A","Z"]

const MAPPING_NUMBERS = [
	['ZERO', 0], 
	['ONE', 1],
	['TWO', 2],
	['THREE', 3],
	['FOUR', 4],
	['FIVE', 5],
	['SIX', 6],
	['SEVEN', 7],
	['EIGHT', 8],
	['NINE', 9],
	['TEN', 10],
	['ELEVEN', 11],
	['TWELVE', 12],
	['THIRTEEN', 13],
	['FOURTEEN', 14],
	['FIFTEEN', 15],
	['SIXTEEN', 16],
	['SEVENTEEN', 17],
	['EIGHTEEN', 18],
	['NINETEEN', 19],
	['TWENTY', 20],
	['THIRTY', 30],
	['FORTY', 40],
	['FIFTY', 50],
	['SIXTY', 60],
	['SEVENTY', 70],
	['EIGHTY', 80],
	['NINETY', 90],
	['DIGIT ZERO', 0], 
	['DIGIT ONE', 1], 
	['DIGIT TWO', 2],
	['DIGIT THREE', 3],
	['DIGIT FOUR', 4],
	['DIGIT FIVE', 5],
	['DIGIT SIX', 6],
	['DIGIT SEVEN', 7],
	['DIGIT EIGHT', 8],
	['DIGIT NINE', 9],
	['NUMBER TEN', 10],
	['NUMBER ELEVEN', 11],
	['NUMBER TWELVE', 12],
	['NUMBER THIRTEEN', 13],
	['NUMBER FOURTEEN', 14],
	['NUMBER FIFTEEN', 15],
	['NUMBER SIXTEEN', 16],
	['NUMBER SEVENTEEN', 17],
	['NUMBER EIGHTEEN', 18],
	['NUMBER NINETEEN', 19],
	['NUMBER TWENTY', 20],
	['ONE HUNDRED', 100],
	['TWO HUNDRED', 200],
	['THREE HUNDRED', 300],
	['FOUR HUNDRED', 400],
	['FIVE HUNDRED', 500],
	['SIX HUNDRED', 600],
	['SEVEN HUNDRED', 700],
	['EIGHT HUNDRED', 800],
	['NINE HUNDRED', 900],
	['ONE THOUSAND', 1000]
];

function find(mapping, form_fn) {
	if (typeof form_fn === 'string') {
		let form = form_fn;
		form_fn = x => form.replace('$', x);
	}	
	let map = {};
	for (let [name, value] of mapping) {
		name = form_fn(name);
		let cp = REV_NAMES[name];
		if (!cp) continue;
		delete REV_NAMES[name];
		map[value] = cp;
	}
	return map;
}

let digits = [
	{name:'Default', form:'DIGIT $'},
	{name:'Superscript', form: 'SUPERSCRIPT $'},
	{name:'Subscript', form: 'SUBSCRIPT $'},
	{name:'Segmented', form: 'SEGMENTED DIGIT $'},
	{name:'Fullwidth', form: 'FULLWIDTH DIGIT $'},
	{name:'Turned', form: 'TURNED DIGIT $'},
	{name:'Circled', form: 'CIRCLED $'},
	{name:'NegativeCircled', form: 'NEGATIVE CIRCLED $'},
	{name:'DoubleCircled', form: 'DOUBLE CIRCLED $'},
	{name:'Parenthesized', form: 'PARENTHESIZED $'},
	{name:'Fullstop', form: '$ FULL STOP'},
	{name:'Roman', form: 'ROMAN NUMERAL $'},
	{name:'Dingbat-NegativeCircled', form: 'DINGBAT NEGATIVE CIRCLED $'},
	{name:'Dingbat-Circled-SansSerif', form: 'DINGBAT CIRCLED SANS-SERIF $'},
	{name:'Dingbat-NegativeCircled-SansSerif', form: 'DINGBAT NEGATIVE CIRCLED SANS-SERIF $'},
	{name:'CopticEpact', form: 'COPTIC EPACT $'},
	{name:'CountingRod-Unit', form: 'COUNTING ROD UNIT DIGIT $'},
	{name:'CountingRod-Tens', form: 'COUNTING ROD TENS DIGIT $'},
	{name:'Tally', form: 'TALLY MARK $'},
	{name:'Tally-Ideographic', form: 'IDEOGRAPHIC TALLY MARK $'},
	{name:'Math-Bold', form: 'MATHEMATICAL BOLD DIGIT $'},
	{name:'Math-DoubleStruck', form: 'MATHEMATICAL DOUBLE-STRUCK DIGIT $'},
	{name:'Math-SansSerif', form: 'MATHEMATICAL SANS-SERIF DIGIT $'},
	{name:'Math-SansSerif-Bold', form: 'MATHEMATICAL SANS-SERIF BOLD DIGIT $'},
	{name:'Math-Monospace', form: 'MATHEMATICAL MONOSPACE DIGIT $'},
	{name:'Comma', form: 'DIGIT $ COMMA'},
	//{name:'Tag', form: 'TAG DIGIT $'}
];

import LETTERS from './letters.js';

let letters = [];
for (let x of LETTERS) {
	let map = find(MAPPING_LETTERS, x.form);
	if (Object.keys(map).length == 0) throw new Error(`empty: ${x.name}`);
	letters.push(...Object.values(map));
}
writeFileSync('./letters.json', JSON.stringify([...new Set(letters)].sort((a, b) => a - b)));

/*
for (let x of digits) {
	let map = find(MAPPING_NUMBERS, x.form);
	if (Object.keys(map).length == 0) throw new Error(`empty: ${x.name}`);
	console.log(x.name, map);

}

*/