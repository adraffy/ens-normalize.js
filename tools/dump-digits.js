// print out all decimal digits

import {UNICODE} from '../derive/unicode-version.js';
import {ens_normalize} from '../src/lib.js';

let buckets = new Map();
for (let char of UNICODE.char_map.values()) {
	if (!Number.isInteger(char.dec)) continue;
	let pos = char.name.lastIndexOf(' '); // meh
	let prefix = char.name.slice(0, pos).trim();
	let bucket = buckets.get(prefix);
	if (!bucket) {
		bucket = Array(10).fill(null);
		buckets.set(prefix, bucket);
	}
	bucket[char.dec] = char;
}

for (let [k, v] of buckets.entries()) {
	if (!v.every(x => x)) {
		buckets.delete(k);
		console.log(`*** Not Decimal: ${k}`);
		continue;
	}
	try {
		let name = String.fromCodePoint(...v.map(x => x.cp));
		let norm = ens_normalize(name);
		if (name !== norm) {
			console.log(`[${k}] "${name}" => "${norm}"`);
		}
	} catch (err) {
		buckets.delete(k);
		console.log(`*** Unable to Normalize: ${k} => ${err.message}`);
	}
}

let map = {};
for (let [k, v] of buckets.entries()) {
	map[k] = String.fromCodePoint(...v.map(x => x.cp));
}

console.log(JSON.stringify(map, null, '\t'));