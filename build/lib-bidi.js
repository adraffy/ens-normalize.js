import {is_bidi_label, validate_bidi} from './bidi.js';
import {label_error} from './utils.js';

export function check_bidi(name) {
	// TODO: fix this
	// determine if emoji interact with bidi
	let labels = name.split('.').map(s => [...s].map(x => x.codePointAt(0)));
	if (labels.some(is_bidi_label)) {
		for (let cps of labels) {
			try {
				validate_bidi(cps);
			} catch (err) {
				throw label_error(cps, err.message);
			}
		}
	}	
}