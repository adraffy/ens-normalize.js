// dump out a list of characters with consistant formatting
// eg. `node names.js 23 2A 30..39 --js"

import {UNICODE, SCRIPTS} from './unicode-version.js';
import {parse_cp_range, hex_cp} from './utils.js';

// TODO: abstract this, add csv, etc
const FORMATS = {
	[undefined]: cp => {
		return `0x${hex_cp(cp)}, // (${UNICODE.get_display(cp)}) ${SCRIPTS.get_details(cp)}`;
	},
	'--js': cp => {
		return UNICODE.js_format(cp);
	},
	'--md': cp => {
		return `* \`${hex_cp(cp)} (${UNICODE.get_display(cp)})\` ${UNICODE.get_name(cp)}`;
	}
};

let check_old;
let formatter;
let args = process.argv.slice(2).filter(arg => {
	if (FORMATS[arg]) {
		formatter = arg;
	} else if (arg === '--old') {
		check_old = true;
	} else {
		return true;
	}
});
formatter = FORMATS[formatter];

let cps;
if (args[0] === 'find') { 
	// search by name/patt
	// TAG.*DIGIT => [E0030, ...]
	let regex = new RegExp(args.slice(1).join(' '), 'i');
	cps = UNICODE.chars.filter(x => regex.test(x.name) || (check_old && regex.test(x.old_name))).map(x => x.cp);
} else { 
	// everything is hex codepoint ranges
	// A B..D => [0xA, 0xB, 0xC, 0xD]
	cps = [...new Set(args.flatMap(parse_cp_range))].sort((a, b) => a - b);
}

for (let cp of cps) {
	console.log(formatter(cp));
}
console.log(cps.length);