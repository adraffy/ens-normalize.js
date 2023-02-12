// find all valid cp+cm+cm names

import {ens_normalize} from '../src/lib.js';
import {read_spec} from '../validate/data.js';
import {writeFileSync} from 'node:fs';

let {cm, groups} = read_spec();
cm = new Set(cm);

let found = new Set();
for (let g of groups) {
	if (g.cm >= 0 && g.cm < 2) continue;

	let valid_cps = [...new Set([...g.primary, ...g.secondary])];	
	let valid_cms = valid_cps.filter(cp => cm.has(cp));
	valid_cps = valid_cps.filter(cp => !cm.has(cp)); 

	let set = new Set();
	for (let cp of valid_cps) {
		for (let cm1 of valid_cms) {
			for (let cm2 of valid_cms) {
				let name = String.fromCodePoint(cp, cm1, cm2);
				try {
					let norm = ens_normalize(name);
					if ([...norm].length >= 3) {
						set.add(norm);
					}
				} catch (err) {
				}
			}
		}
	}
	console.log(g.name, valid_cps.length, valid_cms.length, set.size);	
	for (let x of set) {
		found.add(x);
	}
}
console.log(found.size);

writeFileSync(new URL('./ens-1ch-names.json', import.meta.url), JSON.stringify([...found], null, '\t'));
