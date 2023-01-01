import {encode_arithmetic, MAX_LINEAR} from '../src/encoder.js';
import {decode_arithmetic} from '../src/decoder.js';
import {compare_arrays} from '../src/utils.js';

for (let i = 0; i < 1000; i++) {
	let size = 1 + (Math.random() * 10000)|0;
	let linear = 1 + (Math.random() * MAX_LINEAR)|0;
	let v0 = [];
	for (let i = 0; i < size; i++) {
		if (Math.random() < 0.8) {
			v0.push(Math.random() * linear|0);
		} else {
			v0.push(Math.random() * 0xFFFFFF|0);
		}
	}
	let v1 = encode_arithmetic(v0, linear);
	let v2 = decode_arithmetic(v1);
	if (compare_arrays(v0, v2) != 0) {
		console.log({v0, v1, v2});
		throw new Error('arithmetic');
	}
}

console.log('OK');