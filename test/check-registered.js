import {writeFileSync} from 'fs';
import {join} from 'path';
import {tally, hex_cp} from '../build/utils.js';
import LABELS from './registered-labels.js';
import {ens_normalize, ens_tokenize} from '../dist/ens-normalize.js';

let base_dir = new URL('.', import.meta.url).pathname;

// find all the disallowed characters
// tally them
// sort by frequency
let dis_tally = tally([...LABELS].flatMap(label => ens_tokenize(label).filter(x => x.d !== undefined).map(x => x.d)));
dis_tally = Object.entries(dis_tally).map(([k, n]) => [parseInt(k), n]).sort((a, b) => b[1] - a[1]);
writeFileSync(join(base_dir, './output/reg-dis-chars.json'), JSON.stringify(dis_tally.map(([cp, n]) => {
	 return {n, hex: hex_cp(cp), str: String.fromCodePoint(cp)};
})));

// find all of the errors
// dump as text
let label_errors = [];
for (let label of LABELS) {
	try {
		ens_normalize(label);
	} catch (err) {
		label_errors.push(err.message);
	}
}
writeFileSync(join(base_dir, './output/reg-dis-label.txt'), label_errors.join('\n'));