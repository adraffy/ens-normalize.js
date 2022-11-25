import {read_labels} from './data.js';
import {ens_normalize} from '../src/lib.js';

let labels = read_labels();


for (let label of labels) {
	try {
		ens_normalize(label);
	} catch (err) {
		
		/*
		let error = err.message;
		let i = error.indexOf(':');
		if (i >= 0) error = error.slice(0, i).trim();
		
		if (error.startsWith('whole-label confusable'))
		*/
	}
}