import {readFileSync, writeFileSync} from 'fs';
import {base64_from_bytes} from './compress-utils.js';
import {encode2} from './coder-v2.js';

let TABLE = JSON.parse(readFileSync('tables.json'));

export function perc(x) {
	return (100 * x).toFixed(3) + '%';
}

for (let [k, v] of Object.entries(TABLE)) {
	let n0 = base64_from_bytes(v).length;
	let n1 = base64_from_bytes(encode2(v)).length;
	console.log({table: k, bytes: v.length, n0, n1, p: perc(n1 / n0)});
}

Array.prototype.sum = function() {
	return this.reduce((a, b) => a + b, 0);
};

let n0 = Object.values(TABLE).map(v => v.length).sum();
let n1 = Object.values(TABLE).map(v => encode2(v).length).sum();
let n2 = Object.values(TABLE).map(v => Math.min(v.length, encode2(v).length)).sum();

console.log({
	n0,                    // no compression
	n1, p1: perc(n1 / n0), // always compressed
	n2, p2: perc(n2 / n0)  // whichever is smaller
});

