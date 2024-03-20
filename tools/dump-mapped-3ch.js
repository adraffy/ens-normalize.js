// find all 1chs that expand into 3ch+

import {UNICODE, PRINTER} from '../derive/unicode-version.js';
import {ens_idna_rules} from '../derive/idna.js';
import {ens_normalize} from '../src/lib.js';
import {writeFileSync} from 'node:fs';

let {mapped} = ens_idna_rules(UNICODE);

mapped.sort((a, b) => b[1].length - a[1].length);

let ch = [];
for (let [x, ys] of mapped) {
	if (ys.length >= 3) {
		try {
			ens_normalize(String.fromCodePoint(...ys));
			console.log(PRINTER.desc_for_mapped(x, ys));
			ch.push(String.fromCodePoint(x));
		} catch (err) {
		}
	}
}
writeFileSync(new URL('./output/mapped-3ch.json', import.meta.url), JSON.stringify(ch, null, '\t'));
