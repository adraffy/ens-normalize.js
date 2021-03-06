import {readFileSync} from 'fs';
import {join} from 'path';
import {compare_arrays, explode_cp} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let tests = JSON.parse(readFileSync(join(base_dir, '../build/unicode-json/NormalizationTest.json')));

function test_nf(nfd, nfc) {
	let errors = [];		
	for (let [name, cases] of Object.entries(tests)) {
		let nfd_errors = 0;
		let nfc_errors = 0;
		for (let args of cases) {
			let [src, nfc0, nfd0] = args.map(explode_cp);
			let ndf1 = nfd(src);
			if (compare_arrays(nfd0, ndf1) != 0) {
				nfd_errors++;
				errors.push({src, nfd0, ndf1});
			}
			let nfc1 = nfc(src);
			if (compare_arrays(nfc0, nfc1) != 0) {
				nfc_errors++;
				errors.push({src, nfc0, nfc1});
			}
		}
		console.log(`"${name}" [${cases.length}] NFD(${nfd_errors}) NFC(${nfc_errors})`);
	}
	return errors;
}

import {nfc, nfd} from '../build/nf.js';

let nf_errors = test_nf(nfd, nfc);
if (nf_errors.length > 0) {
	console.log(nf_errors);
	throw new Error('wtf');
}