import {random_bytes, compare_array} from './compress-utils.js';
import {encode2, decode2} from './coder-v2.js';

/*
let a = [0,1,2,3,4,5,6,7,8,9,10,100];
console.log(a);
let b = encode2(a);
console.log(b);
let c = decode2(b);
console.log(c);
console.log(compare_array(a, c));
*/

// check that the latest compressor is correct
for (let i = 0; i < 1000; i++) {
	let v = random_bytes(Math.random() * 1000 | 0)
	if (compare_array(v, decode2(encode2(v))) != 0) {
		throw new Error('wtf');
	}
}