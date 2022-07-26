import REGISTERED from './data/eth-labels.js';
import {ens_normalize, ens_tokenize} from '../build/lib-normalize-v3.js';
import {all_codepoints, read_combining_marks} from '../build/unicode-logic.js';
import {compare_arrays, explode_cp, split_between} from '../build/utils.js';
import {nfc, nfd} from '../build/nf.js';

//import {writeFileSync} from 'fs';
//import {join} from 'path';

let base_dir = new URL('.', import.meta.url).pathname;

let cm = read_combining_marks();


function strip_emoji(name) {
	return ens_tokenize(name).flatMap(t => {
		return t.v ?? t.m ?? t.n ?? [];
	});
}

console.log(cm.size);
console.log(all_codepoints().length);
console.log(all_codepoints().filter(cp => {
	let v = nfd([cp]);
	return v.length == 1 && v[0] == cp;
}).length);
throw 1;


/*
let cps = nfd(strip_emoji("\u{C1}\u{325}\u{326}"));	
let m = split_between(cps, (_, cp) => !cm.has(cp));
console.log(m);
*/

let count_valid = 0;
let count_decomposed = 0;
let count_2 = 0;
let count_3 = 0;
let count_two = 0;

for (let name of REGISTERED) {
	try {
		ens_normalize(name);
	} catch (err) {		
		continue;
	}
	count_valid++;

	let cps = explode_cp(name);
	let cps_nfd = nfd(cps);

	let mc = cps_nfd.map(cp => [cp, cm.has(cp)]);
	let m = split_between(mc, (_, [__, cm]) => !cm);
	
	
	if (compare_arrays(cps, cps_nfd) != 0) {
		count_decomposed++;
	}

	if (m.some(v => v.length >= 2)) {
		count_2++;
	}
	if (m.some(v => v.length >= 3)) {
		count_3++;
	}

	for (let i = 1; i < mc.length; i++) {
		if (mc[i-1][1] && mc[i][1]) {
			count_two++;
			break;
		}
	}



	/*
	let cps = nfd(strip_emoji(name));	
	let m = split_between(cps, (_, cp) => !cm.has(cp));
	
	if (Math.max(m.map(v => v.length)) > 1) {
		count_cm++;
	}
	*/

}

console.log({
	count_valid,
	count_decomposed,
	count_2,
	count_3,
	count_two
});

