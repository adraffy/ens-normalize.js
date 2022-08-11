import {encode_arithmetic} from '../src/encoder.js';
import {decode_arithmetic} from '../src/decoder.js';
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
	if (compare_arrays(v0, v2) != 0) {
		console.log({v0, v1, v2});
		process.exit(1);
	}
}

console.log('OK');