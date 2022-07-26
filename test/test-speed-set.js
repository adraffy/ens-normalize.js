import {binary_search, random_choice, random_sample} from '../build/utils.js';
import {generate_cps} from '../build/unicode-logic.js';

let u = random_sample(generate_cps(), 20000);
let v = random_sample(u, u.length >> 1).sort((a, b) => a - b);
let set = new Set(v);

let N = 100;
let reg = 0;
let t0 = performance.now();
for (let i = 0; i < N; i++) {
	for (let x of u) {
		reg ^= set.has(x);	
	}
}
let t1 = performance.now();
for (let i = 0; i < N; i++) {
	for (let x of u) {
		reg ^= binary_search(v, x);
	}
}	
let t2 = performance.now();
for (let i = 0; i < N; i++) {
	for (let x of u) {
		reg ^= v.indexOf(x);
	}
}
let t3 = performance.now();

console.log('Set.has():', t1 - t0);
console.log('Binary Search', t2 - t1);
console.log('Array.indexOf():', t3 - t2);

/*
Set.has(): 59.440414905548096
Binary Search 159.01185512542725
Array.indexOf(): 11560.541235923767
*/