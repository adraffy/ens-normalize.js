import REGISTERED from './data/eth-labels.js';
import {read_parsed} from '../build/nodejs-utils.js';
import {all_codepoints, read_combining_marks} from '../build/unicode-logic.js';
import {parse_cp, parse_cp_sequence, split_between} from '../build/utils.js';
import {nfd} from '../build/nf.js';

import {writeFileSync} from 'fs';
import {join} from 'path';

let decomp = read_parsed('Decomposition_Mapping');
let cm = read_combining_marks();

console.log(all_codepoints().length, 0x10FFFF);
throw 1;

// [1] = 1035
// [2] = 1026

let tally_len = {};
let tally_cms = {};

for (let [cp, cps] of decomp) {
	cp = parse_cp(cp);
	cps = parse_cp_sequence(cps);

	
	tally_len[cps.length] = (tally_len[cps.length] ?? 0) + 1;

	let key = cps.map(x => cm.has(x)).toString();
	tally_cms[key] = (tally_cms[key] ?? 0) + 1;
	
}

console.log(tally_len);
console.log(tally_cms);

//{ '1': 1035, '2': 1026 }
/*
{ 'false,true': 978, 
          true: 3, 
   'true,true': 48, 
         false: 1032 }
*/
//writeFileSync(join(base_dir, 'output/registered-cm.json'), JSON.stringify(found, null, '\t'));