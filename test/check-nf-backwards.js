import {generate_cps, read_idna_rules} from '../build/unicode-logic.js';
import {nfd} from '../build/nf.js';

let idna = read_idna_rules({version: 2003});

//let reachable = new Set();

for (let cp0 of generate_cps()) {
	let valid0 = idna.valid.has(cp0);
	let cps = nfd([cp0]);
	//if (cps.length === 1 && cps[0] === cp) continue;
	for (let cp of cps) {
		if (valid0 !== idna.valid.has(cp)) {
			console.log(cp0, cp);
		}
	}
}