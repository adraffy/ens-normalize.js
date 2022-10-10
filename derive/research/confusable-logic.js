import {UNICODE, SCRIPTS} from '../unicode-version.js';
import {hex_cp} from '../utils.js';
import {readFileSync, writeFileSync} from 'node:fs';

let confusables = UNICODE.confusables();
let cm = new Set(UNICODE.combin)

// dogfood: filter by processed output
let valid = new Set(JSON.parse(readFileSync(new URL('../output/spec.json', import.meta.url))).valid);

write_file(`Grek`, SCRIPTS.wholes_from_single('Grek', confusables, 'Latn'));
write_file(`Cyrl`, SCRIPTS.wholes_from_single('Cyrl', confusables, 'Latn', 'Grek'));

function write_file(name, m) {	
	let file = new URL(`./confusables-${name}.js`, import.meta.url);
	let lines = [];
	for (let [target, cps] of m) {
		cps = cps.filter(cp => !valid || valid.has(cp));
		if (cps.length == 0) continue;
		
		// TODO FIX THIS

		if (target.length > 1) {
			console.log(target, target.map(cp => UNICODE.cm.has(cp)), String.fromCodePoint(...target));
		}



		for (let cp of cps) {
			lines.push(`\t0x${hex_cp(cp)}, // ${UNICODE.format(cp)} == ${format_target(target)}`);
		}
	}
	writeFileSync(file, [
		'export default [', 
		`\t// computed: ${new Date().toJSON()}`,
		`\t// version: ${UNICODE.version_str}`,
		...lines, 
		']'
	].join('\n'));
	console.log(`Wrote: ${file.pathname}`);
}

function format_target(cps) {
	if (cps.length == 1) {
		return UNICODE.format(cps[0]);
	} else {
		return String.fromCodePoint(...cps) + ' [' + cps.map(x => UNICODE.format(x)) + ']';
	}
}
