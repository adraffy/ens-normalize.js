import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {explode_cp} from './utils.js';

// TODO finish this

import {ens_tokenize as tokenize2003} from '../dist/ens-normalize-2003.js';
import {ens_tokenize as tokenize2008} from '../dist/ens-normalize-2008.js';
import LABELS from './registered_labels.js';


let set = new Set();
for (let label of LABELS) {
	try {
		ens_normalize(label);
	} catch (err) {
		explode_cp(label).filter(is_disallowed).forEach(cp => set.add(cp));
	}
}
set = [...set].sort((a, b) => a - b);

let picto = JSON.parse(readFileSync(join(base_dir, 'tables-json/emoji-pictographic.json')));

set = set.filter(cp => picto.includes(cp));

writeFileSync(join(base_dir, 'disreg2.json'), JSON.stringify([...set].map(cp => ([cp, cp.toString(16), String.fromCodePoint(cp)])), null, 2));