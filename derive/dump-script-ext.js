
import {UNICODE, PRINTER} from './unicode-version.js';
//import {SCRIPT_GROUPS, RESTRICTED_SCRIPTS} from './rules/scripts.js';
import SPEC from './output/spec.json' assert {type: 'json'};
import {print_section} from './utils.js';
 

print_section('Character Extensions');
for (let char of UNICODE.char_map.values()) {
	if (char.extended) {
		console.log(`${PRINTER.js(char.cp)} [${PRINTER.scripts(char.cp)}]`);
	}
}

console.log();
print_section('Net Change');
for (let script of UNICODE.script_map.values()) {
	let loss = script.ext_loss.size;
	let gain = script.ext_gain.size;
	if (loss || gain) {
		console.log(script.abbr, String(-loss).padStart(4), String(gain).padStart(4));
	}
}

console.log();
for (let cp of SPEC.valid) {
	let char = UNICODE.require_char(cp);
	if (char.extended) {
		console.log(`${PRINTER.js(char.cp)} [${PRINTER.scripts(char.cp)}] ${char.extended.filter(x => !x.excluded && !x.limited).map(x => x.abbr).join(',')}`);
	}
}


/*
console.log(UNICODE.require_char(0x30FB).extended.map(x => x.abbr));
console.log(UNICODE.require_char(0x30FC).extended.map(x => x.abbr));
console.log(UNICODE.require_char(0x3013).extended.map(x => x.abbr));

console.log(UNICODE.require_script('Yiii').description);
*/

/*
for (let info of SCRIPT_GROUPS) {
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
		console.log(PRINTER.js(cp));
	}
	console.log(cps.length);
}
*/