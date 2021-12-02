import {ens_normalize} from '../ens-normalize.js';
import IDNAV2 from './data-idna-v2.js';

function explode(s) {
	return [...s].map(x => x.codePointAt(0)).join(' ');
}

for (let [input, output, errors] of IDNAV2) {
	if (!output) output = input;
	let norm, norm_err;
	try {
		norm = ens_normalize(input);		
	} catch (err) {
		norm_err = err.message;
	}
	if (errors) {
		if (norm_err) {
			console.log('same error');
		} else {
			console.log(`accept-error: ${explode(norm)} ; ${explode(input)} ; ${explode(output)} ; ${errors}`);
		}
	} else {
		if (norm_err) {
			console.log(`reject-valid: ${input} ; ${norm_err} ; ${explode(input)}`);
		} else if (norm !== output) {
			console.log(`diff: ${explode(norm)} ; ${explode(input)} ; ${explode(output)}`);
		} else {
			console.log('same');
		}
	}	
}
