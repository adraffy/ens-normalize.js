// this should be an utility for batch querying the state of the spec
// this requires a functioning library (derive => make)

import {ens_tokenize} from '../src/lib.js';
import {UNICODE, SCRIPTS} from '../derive/unicode-version.js';
import {readFileSync} from 'node:fs';
import {parse_cp_range, explode_cp} from '../derive/utils.js';
import {read_labels} from './data.js';




//console.log(read_labels().length);

// TODO FIX ME

let script;

let args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--script') {
		let name = args[i+1];
		script = SCRIPTS.entries.find(x => x.name === name || x.abbr === name);
		if (!script) throw new Error(`unknown script: ${name}`);
	/*} else if (args[i] === '--format') {
		let name = args[i+1];
		switch (format) {
			case 'md':
			case 'js': break;
			default: throw new Error(`unknown format: ${format}`);
		}*/
	}
}

/*


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

let cps = script.set;
//let cps = UNICODE.allowed_identifiers().filter(x => x < 0x3000);


//let cps = parse_cp_range('00..FF');
//let cps = UNICODE.props().Terminal_Punctuation;
//let args = process.argv.slice(2);

function js_format(s) {
	let i = s.indexOf('(');
	return `0x${s.slice(0, i-1)}, // ${s.slice(i)}`;
}

let format = js_format;

for (let cp of cps) {
	let token = ens_tokenize(String.fromCodePoint(cp))[0];
	if (token.type == 'valid') {
		console.log('V', format(UNICODE.format(cp)));
	} else if (token.type === 'mapped') {
		console.log('M', format(UNICODE.format(token.cp, token.cps)));
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