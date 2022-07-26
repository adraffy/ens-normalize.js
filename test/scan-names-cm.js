import REGISTERED from './data/eth-labels.js';
import {read_combining_marks} from '../build/unicode-logic.js';
import {explode_cp, split_between} from '../build/utils.js';
import {nfd} from '../build/nf.js';

import {writeFileSync} from 'fs';
import {join} from 'path';

let base_dir = new URL('.', import.meta.url).pathname;

let cm = read_combining_marks();

let tally = {}; 
let found = {};

for (let name of REGISTERED) {
	//let cps = explode_cp(name).map(cp => [cp, cm.has(cp)]);
	//let m = split_between(cps, (_, [__, cm]) => !cm);

	let cps = nfd(explode_cp(name));
	let m = split_between(cps, (_, cp) => !cm.has(cp));
	let v = m.map(v => v.length);

	for (let v of m) {
		let key = String(v.length);
		tally[key] = (tally[key] ?? 0) + 1
		if (v.length >= 3) {
			found[String.fromCodePoint(...v)] = v;
		}
	}
	
}
console.log(tally);

writeFileSync(join(base_dir, 'output/registered-cm.json'), JSON.stringify(found, null, '\t'));