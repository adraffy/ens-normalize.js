// dump chraracters that arent naturally NFC

import {NF, PRINTER, IDNA} from './unicode-version.js';

let found = [];
for (let cp = 0; cp <= 0x10FFFF; cp++) {
	let nfc = NF.nfc([cp]);
	if (nfc.length !== 1 || nfc[0] !== cp) {
		found.push(cp);
	}
}

for (let cp of found) {
	console.log(PRINTER.js(cp));
}
console.log(found.length);

