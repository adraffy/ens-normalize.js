// dump scripts with decomposable components

import {UNICODE, NF} from './unicode-version.js';
import {SCRIPT_GROUPS, RESTRICTED_SCRIPTS} from './rules/scripts.js';
import {print_section} from './utils.js';

let all = ['Zyyy', 'Zinh'];

let leftover = new Set(UNICODE.script_map.keys());
all.forEach(abbr => leftover.delete(abbr));

for (let g of SCRIPT_GROUPS) {
	let scripts = [...g.test, ...(g.rest ?? [])].map(abbr => UNICODE.require_script(abbr));	
	let cps = [...scripts.flatMap(s => s.map.keys())];
	if (g.extra) cps.push(...g.extra);
	if (cps.some(cp => NF.is_composite(cp))) {
		console.log(g.name);
	}
	g.test.forEach(abbr => leftover.delete(abbr));
}

print_section('Restricted');
for (let abbr of RESTRICTED_SCRIPTS) {
	leftover.delete(abbr);
	if ([...UNICODE.require_script(abbr).map.keys()].some(cp => NF.is_composite(cp))) {
		console.log(abbr);
	}
}

print_section('Leftover');
for (let abbr of leftover) {
	if ([...UNICODE.require_script(abbr).map.keys()].some(cp => NF.is_composite(cp))) {
		console.log(abbr);
	}
}
