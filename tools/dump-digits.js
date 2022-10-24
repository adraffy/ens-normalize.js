import {UNICODE} from '../derive/unicode-version.js';
import {read_spec} from './data.js';

let valid = new Set(read_spec().valid);

let buckets = new Map();
for (let info of UNICODE.chars) {
	if (!Number.isInteger(info.dec)) continue;
	let pos = info.name.lastIndexOf(' '); // meh
	let prefix = info.name.slice(0, pos).trim();
	let bucket = buckets.get(prefix);
	if (!bucket) {
		bucket = Array(10).fill(null);
		buckets.set(prefix, bucket);
	}
	bucket[info.dec] = info;
}

for (let [k, v] of buckets.entries()) {
	if (!v.every(x => x)) {
		buckets.delete(k);
		console.log(`Partial: ${k}`);
	}
}

for (let [k, v] of buckets.entries()) {
	if (!v.every(info => valid.has(info.cp))) {
		buckets.delete(k);
		console.log(`Not Valid: ${k}`);
	}
}

let map = {};
for (let [k, v] of buckets.entries()) {
	map[k] = String.fromCodePoint(...v.map(x => x.cp));
}

console.log(JSON.stringify(map, null, '\t'));