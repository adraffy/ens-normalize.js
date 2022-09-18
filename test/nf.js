import {readFileSync} from 'node:fs';
import {compare_arrays, explode_cp} from '../src/utils.js';
import {nfc as nfc_custom, nfd as nfd_custom} from '../src/nf.js';
import {nfc as nfc_native, nfd as nfd_native} from '../src/nf-native.js';

const TESTS = JSON.parse(readFileSync(new URL('../derive/output/nf-tests.json', import.meta.url)));

function run_tests(nfd, nfc) {
	let errors = [];
	for (let [name, cases] of Object.entries(TESTS)) {
		for (let strs of cases) {
			let [input, nfd0, nfc0] = strs.map(explode_cp);
			let nfd1 = nfd(input);
			if (compare_arrays(nfd0, nfd1)) {
				errors.push({name, input, nfd0, nfd1});
			}
			let nfc1 = nfc(input);
			if (compare_arrays(nfc0, nfc1)) {
				console.log({name, input, nfc0, nfc1});
			}
		}
	}
	return errors;
}

// test custom (must pass)
if (run_tests(nfd_custom, nfc_custom).length) throw new Error('custom');

// test native (might fail)
let errors = run_tests(nfd_native, nfc_native);
if (errors.length) {
	console.log(errors);
	console.log(`Native Errors: ${errors.length}`);
	console.log(`Native Unicode Version: ${process.versions.unicode}`);
}

// compare speed
let m = [];
for (let i = 0; i < 10000; i++) {
	m.push(Array(Math.random() * 1000|0).fill().map(() => Math.random() * 0x110000|0));
}
let t0 = performance.now();
for (let x of m) nfd_custom(x);
for (let x of m) nfc_custom(x);
let t1 = performance.now();
for (let x of m) nfd_native(x);
for (let x of m) nfc_native(x);
let t2 = performance.now();
let t_custom = t1-t0;
let t_native = t2-t1;
console.log({t_custom, t_native, factor: t_custom/t_native});
