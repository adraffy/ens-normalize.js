import {encode_arithmetic, unsafe_btoa, MAX_LINEAR} from '../src/encoder.js';
import {decode_arithmetic, unsafe_atob} from '../src/decoder.js';
import {compare_arrays} from '../src/utils.js';

function rng(n) {
	return (Math.random() * n)|0;
}

for (let i = 0; i < 5000; i++) {
	let v0 = Array.from({length: rng(10000)}, () => rng(256));
	let v1 = unsafe_atob(unsafe_btoa(v0));
	if (compare_arrays(v0, v1) != 0) {
		console.log({v0, v1});
		throw new Error('base64');
	}
}
console.log('PASS base64');

for (let i = 0; i < 1000; i++) {
	let linear = 1 + rng(MAX_LINEAR);
	let v0 = Array.from({length: 1 + rng(10000)}, () => rng(Math.random() < 0.5 ? linear : 0xFFFFFF));
	let v1 = encode_arithmetic(v0, linear);
	let v2 = decode_arithmetic(v1);
	if (compare_arrays(v0, v2) != 0) {
		console.log({v0, v1, v2});
		throw new Error('arithmetic');
	}
}
console.log('PASS arithmetic');
