import {readFileSync, writeFileSync} from 'fs';
import {base64_from_bytes} from './compress-utils.js';
import {encode2} from './coder-v2.js';

let TABLE = JSON.parse(readFileSync('tables.json'));

export function perc(x) {
	return (100 * x).toFixed(3) + '%';
}

function encode2x(v, max = Infinity) {
	let n = 0;
	for (; n < max; n++) {
		let vv = encode2(v);
		if (vv.length > v.length) break;
		v = vv;
	}
	return {v, n}
}

function encoder(v) { 
	return encode2x(v, 3); 
}

for (let [k, v0] of Object.entries(TABLE)) {
	let n0 = base64_from_bytes(v0).length;
	let {v, n} = encoder(v0);
	let n1 = base64_from_bytes(v).length;
	console.log({table: k, bytes: v0.length, apply: n, n0, n1, p: perc(n1 / n0)});
}

Array.prototype.sum = function() {
	return this.reduce((a, b) => a + b, 0);
};

let n0 = Object.values(TABLE).map(v => v.length).sum();
let n1 = Object.values(TABLE).map(v => encoder(v).v.length).sum();

console.log({n0, n1, p1: perc(n1 / n0)});

