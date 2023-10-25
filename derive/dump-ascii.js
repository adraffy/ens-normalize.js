// print ascii characters

import {UNICODE, PRINTER} from './unicode-version.js';

for (let cp = 0; cp < 0x80; cp++) {
	console.log(`${UNICODE.is_printable(cp) ? ' ' : 'X'} ${PRINTER.desc_for_cp(cp)} [${PRINTER.scripts(cp)}]`);
}
