import {nfd, nfc} from '../index.js';

import {readFileSync} from 'fs';
import {join} from 'path';
import {cps_from_sequence, compare_array} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let tests = JSON.parse(readFileSync(join(base_dir, '../build/unicode-json/NormalizationTest.json')));

function test(nfd, nfc) {
	let errors = [];		
	for (let [name, cases] of Object.entries(tests)) {
		let nfd_errors = 0;
		let nfc_errors = 0;
		for (let args of cases) {
			let [src, nfc0, nfd0] = args.map(cps_from_sequence);
			let ndf1 = nfd(src);
			if (compare_array(nfd0, ndf1) != 0) {
				nfd_errors++;
				errors.push({src, nfd0, ndf1});
			}
			let nfc1 = nfc(src);
			if (compare_array(nfc0, nfc1) != 0) {
				nfc_errors++;
				errors.push({src, nfc0, nfc1});
			}
		}
		console.log(`"${name}" [${cases.length}] NFD(${nfd_errors}) NFC(${nfc_errors})`);
	}
	return errors;
}

// adraffy
if (test(nfd, nfc).length > 0) {
	throw new Error('test failed');
}

// javascript
function js_norm(type) {
	return cps => [...String.fromCodePoint(...cps).normalize(type)].map(x => x.codePointAt(0));
}
console.log();
console.log('Javascript:');
test(js_norm('NFD'), js_norm('NFC'));