// test some known names

import {ens_normalize} from '../ens-normalize.js';
import KNOWN from './data/known.js';

KNOWN.forEach(({name, norm, error}, i) => {
	if (!norm) norm = name;
	console.log(`Test ${i+1}`);
	try {
		if (ens_normalize(name) !== norm) {
			throw new Error(`not norm: ${[...name].map(x => x.codePointAt(0)).join(' ')}`); 
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
});

console.log('OK');