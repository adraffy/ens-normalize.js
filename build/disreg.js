import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {explode_cp} from './utils.js';

import {ens_normalize} from './lib-normalize.js';
import {is_disallowed} from './idna.js';

let base_dir = new URL('.', import.meta.url).pathname;

let labels = readFileSync(join(base_dir, '../test/data/eth-labels-20211127-134810-rx6ulbdm52rz.csv'), {encoding: 'utf8'}).split('\n');

let set = new Set();
for (let label of labels) {
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