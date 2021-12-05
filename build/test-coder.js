import {random_bytes, compare_array} from './utils.js';
import {encode2} from './encoder.js';
import {decode2} from './decoder.js';

for (let i = 0; i < 10000; i++) {
	let v = random_bytes(Math.random() * 1000 | 0)
	if (compare_array(v, decode2(encode2(v))) != 0) {
		throw new Error('wtf');
	}
}