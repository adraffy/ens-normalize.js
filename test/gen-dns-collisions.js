import {writeFileSync} from 'fs';
import {escape_unicode, explode_cp, date_str} from '../build/utils.js';
import {puny_encode} from '../build/puny.js';

import REGISTERED from './data/eth-labels.js';
import {ens_normalize} from '../index.js';
import {ens_normalize as idna2003} from '../dist/ens-normalize-2003.js';

console.log(`Registered: ${REGISTERED.size}`);

// find all unique normalized labels
let names = new Set();
for (let x of REGISTERED) {
	try {
		names.add(ens_normalize(x));
	} catch (err) {
	}
}
console.log(`Normable: ${names.size}`);

// count multiplicity 
let map = {};
for (let name of names) {
	let norm;
	try {
		norm = idna2003(name);
	} catch (err) {
		continue;
	}
	let encoded = puny_encode(explode_cp(norm), true);
	let key = encoded.toString();
	let list = map[key];
	if (!list) map[key] = list = [];
	list.push(name);
}
map = Object.values(map);

console.log(`IDNA: ${map.reduce((a, v) => a + v.length, 0)}`);

// remove unique and escape
let collisions = map.filter(v => v.length > 1).map(v => v.map(escape_unicode));

writeFileSync(new URL(`./output/dns-collisions-${date_str}.json`, import.meta.url).pathname, JSON.stringify(collisions));