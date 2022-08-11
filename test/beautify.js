// beautify(emoji - FE0F) == emoji

import {EMOJI} from '@adraffy/ensip-norm';
import {ens_beautify} from '../index.js';
import {explode_cp, filter_fe0f, compare_arrays} from '../src/utils.js';

for (let cps0 of EMOJI) {
	let cps = explode_cp(ens_beautify(String.fromCodePoint(...filter_fe0f(cps0))));
	if (compare_arrays(cps0, cps)) {
		console.log({form: String.fromCodePoint(...cps0), cps0, cps});
		process.exit(1);
	}
}

console.log('OK');