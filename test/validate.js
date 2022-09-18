import { readFileSync } from 'node:fs';
import {ens_normalize, ens_tokenize, ens_normalize_post_check} from '../src/lib.js';
import {str_from_cps} from '../src/utils.js';

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
	return ens_normalize_post_check(ens_tokenize(name).flatMap(token => {
		switch (token.type) {
			case 'disallowed': throw new Error('disallowed'); 
			case 'ignored': return '';
			case 'stop': return '.';
			default: return str_from_cps(token.cps);
		}
	}).join(''));
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

