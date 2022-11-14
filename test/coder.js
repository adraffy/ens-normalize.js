import {encode_arithmetic} from '../src/encoder.js';
import {decode_arithmetic} from '../src/decoder.js';
import {compare_arrays} from '../src/utils.js';

/*
for (let i = 0; i < 1000; i++) {
	let v0 = Array(1000).fill().map(() => Math.random() * 10000|0);
	let enc = new Encoder();
	enc.write_member2(v0);
	let v1 = [...new Set(v0)].sort((a, b) => a - b);
	let v2 = read_sorted(read_payload(enc.values));
	if (compare_arrays(v1, v2)) {
		console.log(v1);
		console.log(v2);
		throw new Error('wtf');
	}
}
*/

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
	if (compare_arrays(v0, v2) != 0) {
		console.log({v0, v1, v2});
		throw new Error('arithmetic');
	}
}
console.log('Arithmetic');

console.log('OK');