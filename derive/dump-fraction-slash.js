// dump fraction-slash idna mappings

import {IDNA, PRINTER} from './unicode-version.js';

let cps = [];

for (let [x, ys] of IDNA.mapped) {
	if (ys.includes(0x2044)) {		
		cps.push(x);
		console.log(PRINTER.desc_for_mapped(x, ys));
	}
}

console.log(String.fromCodePoint(...cps));