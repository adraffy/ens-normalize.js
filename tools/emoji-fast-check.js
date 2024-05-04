import {ens_normalize, ens_tokenize, ens_emoji, ens_beautify} from '../src/lib.js';
import {explode_cp, bytes_from_utf8} from '../derive/utils.js';
import {read_labels} from '../validate/data.js';


// shortest/longest
let max = 0;
let min = Infinity;
let all = new Set();
for (let cps of ens_emoji()) {
	let norm = ens_normalize(String.fromCodePoint(...cps));
	let v = new TextEncoder().encode(norm);
	min = Math.min(min, v.length);
	max = Math.max(max, v.length);
	for (let cp of explode_cp(norm)) {
		all.add(cp);
	}
}
console.log({min, max});
console.log(Math.min(...all), Math.max(...all));


const LABELS = read_labels();

// find registered 3-4s
// find 16 bytes or longer
// https://twitter.com/adraffy/status/1782953777110376809
let short = [];
for (let l of LABELS) {
	try {
		let norm = ens_normalize(l);
		let len = [...norm].length;
		if (len == 3 || len == 4) {
			short.push(norm);
		}
	} catch (err) {
	}
}
let reduced = [];
for (let l of short) {
	if (bytes_from_utf8(l).length >= 16) {
		reduced.push(l);
	} 
}
console.log(short.length);
console.log(reduced.length);


// find mixed subset
let diffs = new Set();
for (let norm of short) {
	let v = ens_tokenize(norm);
	if (v.length == 3 && v.every(x => x.emoji)) {
		let set = new Set(v.map(x => x.emoji.toString()));
		if (set.size > 1) {
			diffs.add(norm);
		}
	}
}
console.log([...diffs].map(ens_beautify).join(' ')); // ~1600
