import {ensNormalize, ensEmoji} from '../src/lib.js';
import {bytes_from_utf8} from '../derive/utils.js';

let map = new Map();
for (let cps of ensEmoji()) {
	let emoji = String.fromCodePoint(...cps);
	let n = bytes_from_utf8(ensNormalize(emoji)).length;
	let rec = map.get(n);
	if (!rec) {
		rec = {bucket: [], n};
		map.set(n, rec);
	}
	rec.bucket.push(emoji);
}
map = [...map.values()].sort((a, b) => a.n - b.n);

for (let rec of map) {
	console.log(rec.n, rec.bucket.length, rec.bucket);
}
