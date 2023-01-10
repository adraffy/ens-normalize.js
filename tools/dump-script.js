// print valid and mapped characters for a script
// eg. node tools/dump-script.js Latn

import {ens_tokenize} from '../src/lib.js';
import {UNICODE, PRINTER} from '../derive/unicode-version.js';
import {print_section} from '../derive/utils.js';

let script = UNICODE.require_script(process.argv[2]);

let valid = 0;
let mapped = 0;

print_section('Valid');
for (let cp of script.map.keys()) {
	let token = ens_tokenize(String.fromCodePoint(cp))[0];
	if (token.type === 'valid') {
		console.log(PRINTER.desc_for_cp(cp));
		valid++;
	}
}
print_section('Mapped');
for (let cp of script.map.keys()) {
	let token = ens_tokenize(String.fromCodePoint(cp))[0];
	if (token.type === 'mapped' && token.cps.some(cp => script.map.has(cp))) {
		console.log(PRINTER.desc_for_mapped(token.cp, token.cps));
		mapped++;
	}
}

console.log({
	name: script.name,
	count: script.map.size,
	valid, 
	mapped
});