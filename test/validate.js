import {run_tests} from '@adraffy/ensip-norm';
import {ens_normalize, ens_tokenize, ens_normalize_post_check} from '../src/lib.js';
import {str_from_cps} from '../src/utils.js';

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
		console.log(`${fn.name} Errors: ${errors.length}`);
		process.exit(1);
	}
	console.log(`PASS ${fn.name}`);
}

