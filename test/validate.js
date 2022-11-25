import {ens_normalize, ens_tokenize, nfc} from '../src/lib.js';
import {readFileSync} from 'node:fs';

const TESTS = JSON.parse(readFileSync(new URL('../validate/tests.json', import.meta.url)));

function run_tests(fn) {
	let errors = [];
	for (let test of TESTS) {
		let {name, norm, error} = test;
		if (typeof norm !== 'string') norm = name;
		try {
			let result = fn(name);
			if (error) {	
				errors.push({type: 'expected error', result, ...test});
			} else if (result != norm) {
				errors.push({type: 'wrong norm', result, ...test});
			}
		} catch (err) {
			if (!error) {
				errors.push({type: 'unexpected error', result: err.message, ...test});
			}
		}
	}
	return errors;
}

// proof of concept
function ens_normalize_via_tokenize(name) {	
	let norm = String.fromCodePoint(...nfc(ens_tokenize(name).flatMap(token => {
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
console.log('OK');

function test(fn) {
	let errors = run_tests(fn);
	if (errors.length) {
		console.log(errors);
		console.log(`Errors: ${errors.length}`);
		throw new Error(fn.name);
	}
	console.log(`PASS ${fn.name}`);
}
