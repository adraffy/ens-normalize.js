import {run_tests} from '@adraffy/ensip-norm';
import {ens_normalize, ens_tokenize} from '../index.js';

function ens_normalize_via_tokenize(name) {
	return ens_tokenize(name).flatMap(token => {
		switch (token.type) {
			case 'disallowed': throw new Error('disallowed'); 
			case 'ignored': return '';
			case 'stop': return '.';
			default: return String.fromCodePoint(...token.cps);
		}
	}).join('');
}

test(ens_normalize);
test(ens_normalize_via_tokenize);
console.log('OK');

function test(fn) {
	let errors = run_tests(fn);
	if (errors.length) {
		console.log(errors);
		console.log(`${fn.name} Errors: ${errors.length}`);
		process.exit(1);
	}
	console.log(`PASS ${fn.name}`);
}

