import {writeFileSync} from 'fs';
import {join} from 'path';
import {tally, hex_cp, explode_cp} from '../build/utils.js';
import LABELS from './registered-labels.js';
import {ens_normalize, ens_tokenize} from '../dist/ens-normalize.js';

let base_dir = new URL('.', import.meta.url).pathname;

// ============================================================\
// find all the characters in any name
// tally them
// sort by frequency
let all_tally = tally([...LABELS].flatMap(explode_cp));
all_tally = Object.entries(all_tally).map(([k, n]) => [parseInt(k), n]).sort((a, b) => b[1] - a[1]);
writeFileSync(join(base_dir, './output/reg-all-chars.json'), JSON.stringify(all_tally.map(([cp, n]) => {
	return {n, hex: hex_cp(cp), str: String.fromCodePoint(cp)};
})));
throw 1;


// ============================================================
// find all the disallowed characters
// tally them
// sort by frequency
let dis_tally = tally([...LABELS].flatMap(label => ens_tokenize(label).filter(x => x.d !== undefined).map(x => x.d)));
dis_tally = Object.entries(dis_tally).map(([k, n]) => [parseInt(k), n]).sort((a, b) => b[1] - a[1]);
writeFileSync(join(base_dir, './output/reg-dis-chars.json'), JSON.stringify(dis_tally.map(([cp, n]) => {
	 return {n, hex: hex_cp(cp), str: String.fromCodePoint(cp)};
})));

// ============================================================
// find all of the errors
let errors = {};
for (let label of LABELS) {
	try {
		ens_normalize(label);
	} catch (err) {
		errors[label] = err.message;
	}
}
writeFileSync(join(base_dir, './output/reg-errors.json'), JSON.stringify(errors));

// ============================================================
// find all the duplicates
let dup_tally = {};
for (let label of LABELS) {
    try {
        let norm = ens_normalize(label);
		let dups = dup_tally[norm];
		if (!dups) {
			dup_tally[norm] = dups = [];
		}
		dups.push(label)
    } catch (err) {
    }
}
for (let [norm, dups] of Object.entries(dup_tally)) {
	if (dups.length == 1) {
		delete dup_tally[norm];
		continue;
	}
	let set = new Set(dups.map(s => s.toLowerCase()));
	if (set.size == 1) {
		delete dup_tally[norm];
		continue;
	}
}
writeFileSync(join(base_dir, './output/reg-dups.json'), JSON.stringify(dup_tally));