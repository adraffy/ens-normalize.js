// test some known names

import {ens_normalize} from '../ens-normalize.js';
import KNOWN from './known.js';

for (let {name, norm, error} of KNOWN) {
	if (!norm) norm = name;
	try {
		if (ens_normalize(name) !== norm) {
			throw new Error(`not norm: ${name}`);
		}
		if (error) {
			throw new Error('expected error');
		}
	} catch (err) {
		if (!error) {
			console.error(err);
			process.exit(1);
		}
	}
}

console.log('OK');