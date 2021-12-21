import {decode_arithmetic} from './decoder.js';
import {encode_arithmetic} from './encoder.js';
import {compare_array} from './utils.js';

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
	if (compare_array(v0, v2) != 0) {
		console.log({v0, v1, v2});
		throw new Error('wtf');
	}
}