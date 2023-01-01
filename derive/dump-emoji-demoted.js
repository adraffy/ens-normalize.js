// find emoji that were mapped by IDNA 2003 

import {UNICODE, IDNA, PRINTER} from './unicode-version.js';

const mapped = new Set(IDNA.mapped.map(x => x[0]));

PRINTER.js_header();

console.log();
for (let info of UNICODE.read_emoji_data().Emoji) {
	if (mapped.has(info.cp)) {
		console.log(PRINTER.js(info));
	}
}
