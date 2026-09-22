// dump out a list of characters with consistant formatting
// eg. `node names.js $ 23 2A 30..39"

import {IDNA, PRINTER, UNICODE} from './unicode-version.js';
import {explode_cp, hex_cp, parse_cp_range} from './utils.js';

let check_old;
let format = 'js';
let args = process.argv.slice(2).filter(arg => {
	const match = arg.match(/^--format=(.*)$/);
	if (match) {
		format = match[1];
	} else if (arg === '--old') {
		check_old = true;
	} else {
		return true;
	}
	return false;
});

let cps;
if (args[0] === 'find') { // search by name/patt
	const regex = new RegExp(args.slice(1).join(' '), 'i');
	cps = [...UNICODE.char_map.values()].filter(x => {
		if (regex.test(x.name)) return true;
		if (regex.test(x.short)) return true;
		if (check_old && regex.test(x.old_name)) return true;
		return false;
	}).map(x => x.cp);
} else if (args[0] === 'script') {
	cps = [...UNICODE.require_script(args[1]).map.keys()];
} else if (args[0] === 'prop') {
	const props = UNICODE.read_props();
	cps = args.slice(1).flatMap(prop => {
		const v = props[prop];
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
	args = args.flatMap(arg => {
		return /^[0-9a-f]/i.test(arg) ? parse_cp_range(arg) : explode_cp(arg).map(hex_cp);
	});
	cps = [...new Set(args)].sort((a, b) => a - b);
}

// TODO: fix this
switch (format) {
	case 'md':
	case 'jss':
	case `jsstr`:
	case 'js': {
		for (const cp of cps) {
			console.log(PRINTER[format](cp));
		}
		console.log(cps.length);
		break;
	}
	case 'csv': {
		console.log(`Dec,Hex,Form,Name`);
		for (const cp of cps) {
			console.log(`${cp},${hex_cp(cp)},"${UNICODE.get_display(cp)}","${UNICODE.get_name(cp)}"`);
		}
		break;
	}
	default: throw new Error(`unknown format: ${format}`);
}

