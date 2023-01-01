// compute extension changes

import {UNICODE, PRINTER} from './unicode-version.js';
import {print_section} from './utils.js';

print_section('Character Extensions');
for (let ch of UNICODE.char_map.values()) {
	if (ch.extended) {
		console.log(`${PRINTER.desc_for_cp(ch.cp)} [${PRINTER.scripts(ch.cp)}]`);
	}
}

let gained_map = new Map();
for (let ch of UNICODE.char_map.values()) {
	if (!ch.extended) continue;
	for (let script of ch.extended) {
		let bucket = gained_map.get(script);
		if (!bucket) {
			bucket = [];
			gained_map.set(script, bucket);
		}
		bucket.push(ch);
	}
}

console.log();
print_section('Net Change');
for (let script of UNICODE.script_map.values()) {
	let lost = [...script.map.values()].filter(ch => ch.extended && !ch.extended.includes(script));
	let gained = gained_map.get(script) ?? [];
	if (lost.length || gained.length) {
		console.log(script.abbr, String(-lost.length).padStart(4), String(gained.length).padStart(4));
	}
}
