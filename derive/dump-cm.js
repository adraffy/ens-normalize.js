import {PRINTER, UNICODE} from './unicode-version.js';
import {group_by, print_section} from './utils.js';

let tally = group_by([...UNICODE.char_map.values()].filter(x => x.is_cm), x => x.script);

for (let [script, bucket] of tally) {
	print_section(`${script.description} (${bucket.length})`);
	for (let char of bucket) {
		console.log(PRINTER.js(char.cp));
	}
}

console.log([...tally.entries()].map(([s, v]) => [s.description, v.length]).sort((a, b) => b[1]-a[1]));