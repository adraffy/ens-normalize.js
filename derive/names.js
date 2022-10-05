// dump out a list of characters with consistant formatting
// eg. `node names.js 23 2A 30..39`
// eg. `node names.js -- aɑ

import {UNICODE} from './unicode-version.js';
import {parse_cp_range, explode_cp} from './utils.js';

let args = process.argv.slice(2);
let format;
switch (args[0]) {
	case 'md': // markdown (eg. draft.md)
	case 'js': // javascript (eg. rules/*.js)
		format = args.shift();
}
let mode;
switch (args[0]) {
	case 'find': 
	case '--':
		mode = args.shift();
}
let cps;
if (mode === 'find') { // search by name
	let query = args.join(' ').toLowerCase();
	cps = UNICODE.chars.filter(x => x.name.toLowerCase().includes(query) || x.old_name.toLowerCase().includes(query)).map(x => x.cp);
} else if (mode == '--') { // everything is literal
	cps = explode_cp(args.join(' '));
} else { // everything is hex codepoint ranges
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