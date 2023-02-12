// dump chraracters that arent naturally NFC

import {NF, PRINTER} from './unicode-version.js';

let found = [];
for (let cp = 0; cp <= 0x10FFFF; cp++) {
	if (NF.is_composite(cp)) {
		found.push(cp);
	}
}

for (let cp of found) {
	console.log(`${PRINTER.desc_for_cp(cp)} [${PRINTER.scripts(cp)}]`);
}
console.log(found.length);
