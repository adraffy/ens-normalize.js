import {readFileSync} from 'fs';
import {join} from 'path';
import {explode_cp} from '../build/utils.js';
import {nfc_adraffy, nfd_adraffy, nfc_default, nfd_default} from '../build/lib-nf.js';

let base_dir = new URL('.', import.meta.url).pathname;

let tests = JSON.parse(readFileSync(join(base_dir, '../build/unicode-json/NormalizationTest.json')));

// alternative sources
let forms_python = JSON.parse(readFileSync(join(base_dir, 'data/nf-python.json')));
let forms_wolfram = JSON.parse(readFileSync(join(base_dir, 'data/nf-wolfram.json')));

let adraffy = 0;
let python = 0;
let wolfram = 0;
let js = 0;

for (let [name, cases] of Object.entries(tests)) {
	let results_python = forms_python[name];
	let results_wolfram = forms_wolfram[name];
	if (results_python.length != results_wolfram.length || results_wolfram.length != cases.length) throw new Error('wtf');
	for (let i = 0; i < cases.length; i++) {
		let [src, nfc0, nfd0] = cases[i];
		let cps = explode_cp(src);
		let adraffy_c = String.fromCodePoint(...nfc_adraffy(cps));
		let adraffy_d = String.fromCodePoint(...nfd_adraffy(cps));
		let js_c = String.fromCodePoint(...nfc_default(cps));
		let js_d = String.fromCodePoint(...nfd_default(cps));

		let [python_c, python_d] = results_python[i];
		let [wolfram_c, wolfram_d] = results_wolfram[i];
		if (nfc0 !== adraffy_c) adraffy++;
		if (nfd0 !== adraffy_d) adraffy++;
		if (nfc0 !== js_c) js++;
		if (nfd0 !== js_d) js++;
		if (nfc0 !== python_c) python++;
		if (nfd0 !== python_d) python++;
		if (nfc0 !== wolfram_c) wolfram++;
		if (nfd0 !== wolfram_d) wolfram++;
	}		
}

console.log({adraffy, js, python, wolfram});