// print valid and mapped characters for a script

import {ens_tokenize} from '../src/lib.js';
import {UNICODE, SCRIPTS} from '../derive/unicode-version.js';

let formatter = (...a) => UNICODE.format(...a);

let args = process.argv.slice(2).filter(arg => {
	if (arg === 'js') {
		formatter = (...a) => UNICODE.js_format(...a);;
	} else {
		return true;
	}
});

let script = SCRIPTS.require(args[0]);

let valid = 0;
let mapped = 0;

for (let cp of script.set) {
	let token = ens_tokenize(String.fromCodePoint(cp))[0];
	if (token.type == 'valid') {
		console.log(formatter(cp));
		valid++;
	}
}
console.log();

for (let cp of script.set) {
	let token = ens_tokenize(String.fromCodePoint(cp))[0];
	if (token.type == 'mapped' && token.cps.some(cp => script.set.has(cp))) {
		console.log(formatter(token.cp, token.cps));
		mapped++;
	}
}

console.log({
	name: script.name,
	count: script.set.size,
	valid, 
	mapped
});