// print ascii characters

import {PRINTER} from './unicode-version.js';

for (let cp = 0; cp < 0x80; cp++) {
	console.log(`${PRINTER.desc_for_cp(cp)} [${PRINTER.scripts(cp)}]`);
}
