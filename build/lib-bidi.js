import {is_bidi_label, validate_bidi_label} from './bidi.js';
import {explode_cp} from './utils.js';

export {is_bidi_label, validate_bidi_label};

export function check_bidi(name) {
	let labels = name.split('.').map(explode_cp);
	if (labels.some(is_bidi_label)) {
		for (let cps of labels) {
			try {
				validate_bidi(cps);
			} catch (err) {
				throw new Error(`Disallowed bidi label "${escape_unicode(String.fromCodePoint(...cps))}": ${err.message}`);
			}
		}
	}	
}