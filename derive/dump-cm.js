import {PRINTER, UNICODE} from './unicode-version.js';
import {group_by, print_section} from './utils.js';

let tally = group_by([...UNICODE.char_map.values()].filter(x => x.is_cm), x => x.script);

for (let [script, bucket] of tally) {
	print_section(script.description);
	for (let char of bucket) {
		console.log(PRINTER.js(char.cp));
	}
}

console.log([...tally.entries()].map(([s, v]) => [s.description, v.length]));

/*
import {RESTRICTED_SCRIPTS} from './rules/scripts.js';
for (let [script, bucket] of tally) {
	if (RESTRICTED_SCRIPTS.includes(script.abbr)) {
		print_section(script.description);
		for (let char of bucket) {
			console.log(PRINTER.js(char.cp));
		}
	}
}
*/

/*
print_section('With X');
let [cp0] = explode_cp('x');
for (let cp of UNICODE.cm) {
	console.log(String.fromCodePoint(0x78, cp0));
}
*/