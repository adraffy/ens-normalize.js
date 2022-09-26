// dump out a list of characters with consistant formatting
// eg. `node names.js 23 2A 30..39`
// eg. `node names.js -- aɑ

import {UNICODE} from './unicode-version.js';
import {parse_cp_range, explode_cp} from './utils.js';

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
for (let cp of cps) {
	switch (format) {
		case 'md': console.log(`* \`${UNICODE.format(cp)}\``); continue;
		case 'js': {
			let s = UNICODE.format(cp);
			let i = s.indexOf('(');
			console.log(`0x${s.slice(0, i-1)}, // ${s.slice(i)}`); 
			continue;
		}
		default: console.log(UNICODE.format(cp));
	}
}