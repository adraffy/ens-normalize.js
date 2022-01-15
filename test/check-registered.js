import {writeFileSync} from 'fs';
import {join} from 'path';

//import {explode_cp} from './utils.js';

import LABELS from './registered-labels.js';
import {ens_tokenize, ens_normalize, hex_cp} from '../dist/ens-normalize-debug.js';

let base_dir = new URL('.', import.meta.url).pathname;

let disallowed = [...LABELS].flatMap(label => ens_tokenize(label).filter(x => x.d !== undefined).map(x => x.d));
disallowed = [...new Set(disallowed)].sort((a, b) => a - b);

writeFileSync(join('./output/reg-dis-chars.json'), JSON.stringify(disallowed.map(cp => ({hex: hex_cp(cp), str: String.fromCodePoint(cp)}))));

let label_errors = [];
for (let label of LABELS) {
	try {
		ens_normalize(label);
	} catch (err) {
		label_errors.push(err.message);
	}
}

writeFileSync(join('./output/reg-dis-label.txt'), label_errors.join('\n'));