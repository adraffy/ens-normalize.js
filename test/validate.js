import {ens_normalize, ens_tokenize, nfc} from '../src/lib.js';
import {str_from_cps, run_tests, explode_cp} from '../src/utils.js';
import {readFileSync} from 'node:fs';

let file = process.argv[2];
if (!file) file = new URL('../validate/tests.json', import.meta.url).pathname;
console.log(`Testing: ${file}`);

const TESTS = JSON.parse(readFileSync(file));

// proof of concept
function ens_normalize_via_tokenize(name) {	
	let norm = str_from_cps(nfc(ens_tokenize(name).flatMap(token => {
		switch (token.type) {
			case 'disallowed': throw new Error('disallowed'); 
			case 'ignored': return [];
			case 'stop': return token.cp;
			default: return token.cps;
		}
	})));
	if (ens_normalize(norm) !== norm) {
		throw new Error(`wrong: ${norm}`);
	}
	return norm;
}

test(ens_normalize);
test(ens_normalize_via_tokenize);

function test(fn) {
	let errors = run_tests(fn, TESTS);
	if (errors.length) {
		console.log(errors);
		console.log(`Errors: ${errors.length}`);
		throw new Error(fn.name);
	}
	console.log(`PASS ${fn.name}`);
}
