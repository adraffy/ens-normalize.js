// dump out a list of characters with consistant formatting
// eg. `node names.js 23 2A 30..39"

import {UNICODE, PRINTER, IDNA} from './unicode-version.js';
import {parse_cp_range, hex_cp} from './utils.js';

let check_old;
let format = 'js';
let args = process.argv.slice(2).filter(arg => {
	let match = arg.match(/^--format=(.*)$/);
	if (match) {
		format = match[1];
	} else if (arg === '--old') {
		check_old = true;
	} else {
		return true;
	}
});

let cps;
if (args[0] === 'find') { // search by name/patt
	let regex = new RegExp(args.slice(1).join(' '), 'i');
	cps = [...UNICODE.char_map.values()].filter(x => {
		if (regex.test(x.name)) return true;
		if (regex.test(x.short)) return true;
		if (check_old && regex.test(x.old_name)) return true;
	}).map(x => x.cp);
} else if (args[0] === 'script') {
	cps = [...UNICODE.require_script(args[1]).map.keys()];
} else if (args[0] === 'prop') {
	let props = UNICODE.read_props();
	cps = args.slice(1).flatMap(prop => {
		let v = props[prop];
		if (!v) throw new Error(`unknown property: ${prop}`);
		return v;
	});
} else if (args[0] === 'idna-valid') {
	cps = IDNA.valid;
} else if (args[0] === 'idna-ignored') {
	cps = IDNA.ignored;
} else if (args[0] === 'idna-mapped') {
	cps = IDNA.mapped.map(x => x[0]);
} else if (args[0] === 'cm') {
	cps = [...UNICODE.cm];
} else { 
	// everything is hex codepoint ranges
	// A B..D => [0xA, 0xB, 0xC, 0xD]
	cps = [...new Set(args.flatMap(parse_cp_range))].sort((a, b) => a - b);
}

// TODO: fix this
switch (format) {
	case 'md':
	case 'jss':
	case `jsstr`:
	case 'js': {
		for (let cp of cps) {
			console.log(PRINTER[format](cp));
		}
		console.log(cps.length);
		break;
	}
	case 'jss': {
		for (let cp of cps) {
			console.log(PRINTER.jss(cp));
		}
		console.log(cps.length);
		break;
	}
	case 'csv': {
		console.log(`Dec,Hex,Form,Name`);
		for (let cp of cps) {
			console.log(`${cp},${hex_cp(cp)},"${UNICODE.get_display(cp)}","${UNICODE.get_name(cp)}"`);
		}
		break;
	}
	default: throw new Error(`unknown format: ${format}`);
}

