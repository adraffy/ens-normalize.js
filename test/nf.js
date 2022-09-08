import {compare_arrays, explode_cp} from '../src/utils.js';
import {readFileSync} from 'node:fs';
import {nfc, nfd} from '../src/nf.js';
//import {nfc, nfd} from '../src/nf-native.js';

const TESTS = JSON.parse(readFileSync(new URL('./NormalizationTest.json', import.meta.url)));

let errors = test_nf(nfd, nfc);
if (errors.length) {
	console.log(errors);
	console.log(`Errors: ${errors.length}`);
	process.exit(1);
}
console.log('OK');

function test_nf(nfd, nfc) {
	let errors = [];		
	for (let [name, cases] of Object.entries(TESTS)) {
		let nd = 0;
		let nc = 0;
		for (let args of cases) {
			let [src, nfc0, nfd0] = args.map(explode_cp);
			let ndf1 = nfd(src);
			if (compare_arrays(nfd0, ndf1) != 0) {
				nd++;
				errors.push({src, nfd0, ndf1});
			}
			let nfc1 = nfc(src);
			if (compare_arrays(nfc0, nfc1) != 0) {
				nc++;
				errors.push({src, nfc0, nfc1});
			}
		}
		console.log(`${nd|nc ? 'FAIL' : 'PASS'} "${name}" [${cases.length}] NFD(${nd}) NFC(${nc})`);
	}
	return errors;
}


