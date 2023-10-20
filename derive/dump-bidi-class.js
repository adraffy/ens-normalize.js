import {UNICODE, PRINTER} from './unicode-version.js';
import {explodeCp} from './utils.js';

// TODO: improve this input mechanism
for (let cp of new Set(explodeCp(process.argv.slice(2).join('')))) {
	let ch = UNICODE.char_map.get(cp);
	console.log((ch ? ch.bidi_class : '?').padEnd(3), PRINTER.desc_for_cp(cp));
}