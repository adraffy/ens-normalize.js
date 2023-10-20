import {ensNormalize, ensTokenize, nfc} from '../src/lib.js';
//import {ensNormalize, ensTokenize, nfc} from '../../ens-norm-tests/old-versions/1.8.9.js';

import {strFromCps, runTests} from '../src/utils.js';
import {readFileSync} from 'node:fs';

let file = process.argv[2];
if (!file) file = new URL('../validate/tests.json', import.meta.url).pathname;
console.log(`Testing: ${file}`);

const TESTS = JSON.parse(readFileSync(file));

test(ensNormalize);
test(ensNormalize_via_tokenize);

// proof of concept
function ensNormalize_via_tokenize(name) {	
	let norm = strFromCps(nfc(ensTokenize(name).flatMap(token => {
		switch (token.type) {
			case 'disallowed': throw new Error('disallowed'); 
			case 'ignored': return [];
			case 'stop': return token.cp;
			default: return token.cps;
		}
	})));
	if (ensNormalize(norm) !== norm) { 
		throw new Error(`wrong: ${norm}`);
	}
	// an ignorable single label filters to an empty string
	// and wont throw due to empty label allowance
	if (!norm) ensNormalize(name);
	return norm;
}

function test(fn) {
	let errors = runTests(fn, TESTS);
	if (errors.length) {
		console.log(errors);
		console.log(`Errors: ${errors.length}`);
		throw new Error(fn.name);
	}
	console.log(`PASS ${fn.name}`);
}
