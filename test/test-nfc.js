//import {nfc} from '../index.js';
import {nfd, nfc} from '../build/ens-normalize.js';

import {mkdirSync, writeFileSync, readFileSync} from 'fs';
import {join} from 'path';
import {escape_unicode, cps_from_sequence, compare_array} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');
let tests = JSON.parse(readFileSync(join(base_dir, '../build/unicode-json/NormalizationTest.json')));


for (let [name, cases] of Object.entries(tests)) {
	console.log(name);
	for (let v of cases) {
		let [src, nfc0, nfd0] = v.map(cps_from_sequence);
		let ndf1 = nfd(src);
		if (compare_array(nfd0, ndf1) != 0) {
			console.log({src, nfd0, ndf1});
			throw new Error(`nfd`);
		}
		let nfc1 = nfc(src);
		if (compare_array(nfc0, nfc1) != 0) {
			console.log({src, nfc0, nfc1});
			throw new Error(`nfc`);
		}

		/*
		src = String.fromCodePoint(...src);
		dst = String.fromCodePoint(...);
		if (src.normalize('NFC') !== dst) {

			console.log([escape_unicode(src), escape_unicode(dst)]);
			
		}
		*/

	}
}