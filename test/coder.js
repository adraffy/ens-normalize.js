import {encode_arithmetic, unsafe_btoa} from '../src/encoder.js';
import {decode_arithmetic, unsafe_atob} from '../src/decoder.js';
import {compare_arrays} from '../src/utils.js';

for (let i = 0; i < 1000; i++) {
	let n = 1 + (Math.random() * 10000)|0;
	let u = 1 + (Math.random() * 500)|0;
	let v0 = [];
	for (let i = 0; i < n; i++) {
		if (Math.random() < 0.8) {
			v0.push(Math.random() * u|0);
		} else {
			v0.push(Math.random() * 0xFFFFFF|0);
		}
	}
	let v1 = encode_arithmetic(v0, u);
	let v2 = decode_arithmetic(v1);
	if (compare_arrays(v0, v2)) {
		console.log({v0, v1, v2});
		throw new Error('arthimetic');
	}
}
console.log(`PASS arthimetic`);

for (let i = 0; i < 10000; i++) {
	let v0 = Buffer.from(Array(Math.random() * 1000|0).fill().map(() => Math.random() * 255|0));
	let s = unsafe_btoa(v0);
	let v1 = Uint8Array.from(atob(s), c => c.codePointAt(0));
	let v2 = unsafe_atob(s);
	if (compare_arrays(v1, v2)) {
		console.log({s, v0, v1, v2});
		throw new Error('bota');
	}
}
console.log(`PASS atob`);

console.log('OK');