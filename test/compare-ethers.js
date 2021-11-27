import {nameprep} from '@ethersproject/strings';
import {ens_normalize} from '../ens-normalize.js';
import {KNOWN} from './known.js';

for (let {name, norm, error} of KNOWN) {
	
	if (!norm) norm = name;
	try {
		let norm1 = ens_normalize(name);
		let norm2 = nameprep(name);
		if (norm1 != norm2) {

		}
		
	} catch (err) {
		if (!error) {
			console.error(err);
			process.exit(1);
		}
	}
}