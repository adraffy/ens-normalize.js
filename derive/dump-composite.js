// dump characters that arent naturally NFC

import {MAX_CP} from './utils.js';
import {NF, PRINTER} from './unicode-version.js';

let found = [];
for (let cp = 0; cp <= MAX_CP; cp++) {
	if (NF.is_composite(cp)) {
		found.push(cp);
	}
}

for (let cp of found) {
	console.log(`${PRINTER.desc_for_cp(cp)} [${PRINTER.scripts(cp)}]`);
}
console.log(found.length);
