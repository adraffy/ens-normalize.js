import {SPEC, SCRIPTS} from '../unicode-version.js';
import {hex_cp} from '../utils.js';
import {writeFileSync} from 'node:fs';

let confusables = SPEC.confusables();

write_file(`Grek`, SCRIPTS.wholes_from_single('Grek', confusables, 'Latn'));
write_file(`Cyrl`, SCRIPTS.wholes_from_single('Cyrl', confusables, 'Latn', 'Grek'));

function write_file(name, m) {	
	let file = new URL(`./confusables-${name}.js`, import.meta.url);
	writeFileSync(file, [
		'export default [', 
		`\t// computed: ${new Date().toJSON()}`,
		`\t// version: ${SPEC.version_str}`,
		m.map(([target, cps]) => {
			return cps.map(cp => {
				return `\t0x${hex_cp(cp)}, // ${SPEC.format(cp)} == ${format_target(target)}`;
			})
		}), 
		']'
	].flat(Infinity).join('\n'));
	console.log(`Wrote: ${file.pathname}`);
}

function format_target(cps) {
	if (cps.length == 1) {
		return SPEC.format(cps[0]);
	} else {
		return String.fromCodePoint(...cps) + ' [' + cps.map(x => SPEC.format(x)) + ']';
	}
}
