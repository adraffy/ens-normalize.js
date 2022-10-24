
import {UNICODE, PRINTER} from './unicode-version.js';
import {ORDERED_SCRIPTS, RESTRICTED_SCRIPTS} from './rules/scripts.js';
import SPEC from './output/spec.json' assert {type: 'json'};
 
let valid = new Set(SPEC.valid);

let ext = UNICODE.script_extensions();

for (let info of ORDERED_SCRIPTS) {
	let cps = [];
	for (let [cp, abbrs] of ext) {
		if (valid.has(cp) && abbrs.some(abbr => info.test.includes(abbr))) {
			cps.push(cp);
		}
	}
	cps.sort((a, b) => a - b);
	console.log();
	console.log(info.name);
	for (let cp of cps) {
		console.log(PRINTER.js_char(cp));
	}
	console.log(cps.length);
}
