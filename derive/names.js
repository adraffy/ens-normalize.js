// dump out a list of characters with consistant formatting
// eg. `node names.js 23 2A 30..39`
// eg. `node names.js -- aɑ

import {UnicodeSpec} from './unicode-logic.js';
import {parse_cp_range, explode_cp} from './utils.js';

const spec = new UnicodeSpec(new URL('./data/15.0.0/', import.meta.url));

let args = process.argv.slice(2);
let cps;
if (args[0] == '--') {
	cps = explode_cp(args.slice(1).join(' '));
} else {
	cps = [...new Set(process.argv.slice(2).flatMap(parse_cp_range))].sort((a, b) => a - b);
}

for (let cp of cps) {
	console.log(spec.format(cp));
}
