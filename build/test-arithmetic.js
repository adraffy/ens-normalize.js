import {arithmetic_decoding} from './decoder.js';
import {arithmetic_encoding} from './encoder.js';
import {compare_array} from './utils.js';

/*
let v0 = [0, 1, 5, 1, 2, 2, 3, 4, 5, 1000, 10];
let v1 = arithmetic_encoder(v0, 5);
console.log(v1);
let v2 = arithmetic_decoder(v1);
console.log(v2);
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
	let v1 = arithmetic_encoding(v0, u);
	let v2 = arithmetic_decoding(v1);
	if (compare_array(v0, v2) != 0) {
		console.log({v0, v1, v2});
		throw new Error('wtf');
	}
}