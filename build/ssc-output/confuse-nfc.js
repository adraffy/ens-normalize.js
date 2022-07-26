import {read_parsed} from '../nodejs-utils.js';
import {parse_cp_sequence, compare_arrays, quote_cp} from '../utils.js';
import {read_idna_rules} from '../unicode-logic.js';
import {nfc} from '../nf.js';

let valid = new Set(read_idna_rules({version: 2008}).valid);

for (let [confuse, matches] of Object.entries(read_parsed('confusables'))) { // hex -> [hex hex]
	matches = [confuse, ...matches].map(parse_cp_sequence);
	confuse = String.fromCodePoint(...parse_cp_sequence(confuse));
	for (let cps0 of matches) {
		let cps = nfc(cps0); // convert to nfc
		if (!cps.every(cp => valid.has(cp))) continue; // not possible 

		if (compare_arrays(cps0, cps)) {
			console.log(cps0.map(quote_cp).join(''), cps.map(quote_cp).join(''), String.fromCodePoint(...cps0), String.fromCodePoint(...cps))
		}
	}
}