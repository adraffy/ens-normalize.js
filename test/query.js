// this should be an utility for batch querying the state of the spec
// this requires a functioning library (derive => make)

import {ens_tokenize} from '../src/lib.js';
import {UnicodeSpec} from '../derive/unicode-logic.js';
import {parse_cp_range, explode_cp} from '../derive/utils.js';

const spec = new UnicodeSpec(new URL('../derive/data/15.0.0/', import.meta.url));

// TODO FIX ME

/*
let args = process.argv.slice(2);
let cps;
let format;
switch (args[0]) {
	case 'md': // markdown (eg. draft.md)
	case 'js': // javascript (eg. rules/*.js)
		format = args.shift();
}
if (args[0] == '--') { // everything after is literal
	cps = explode_cp(args.slice(1).join(' '));
} else {
	cps = [...new Set(args.flatMap(parse_cp_range))].sort((a, b) => a - b);
}
*/

let cps = parse_cp_range('00..FF');

for (let cp of cps) {
	let token = ens_tokenize(String.fromCodePoint(cp))[0];
	if (token.type == 'valid') {
		console.log(spec.format(cp));
	} else if (token.type === 'mapped') {
		console.log(spec.format(token.cp, token.cps));
	}
}