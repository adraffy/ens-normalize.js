// this should be an utility for batch querying the state of the spec
// this requires a functioning library (derive => make)

import {ens_tokenize} from '../src/lib.js';
import {UNICODE} from '../derive/unicode-version.js';
import {readFileSync} from 'node:fs';
import {parse_cp_range, explode_cp} from '../derive/utils.js';
import {read_labels} from './data.js';

//console.log(read_labels().length);

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

//let cps = parse_cp_range('00..FF');
let cps = UNICODE.props().Terminal_Punctuation;

for (let cp of cps) {
	let token = ens_tokenize(String.fromCodePoint(cp))[0];
	if (token.type == 'valid') {
		console.log('V', UNICODE.format(cp));
	} else if (token.type === 'mapped') {
		console.log('M', UNICODE.format(token.cp, token.cps));
	}
}

/*
for (let label of read_labels()) {
	let cps = explode_cp(label);
	if (cps.includes(0x5BE)) {
		console.log({label, cps});
	}
}
*/