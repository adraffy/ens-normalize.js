import {is_bidi_label, validate_bidi_label} from './bidi.js';
import {explode_cp} from './utils.js';

// CAUTION: this is mini-library assumes that the input
// has already been IDNA transformed (and puny decoded)

// returns true if the code-point array is bidi
export {is_bidi_label};

// throws if the code-point array violates bidi rules
export {validate_bidi_label};

// return true if the domain name is a bidi domain
export function is_bidi_domain_name(name) {
	return name.split('.').some(s => is_bidi_label(explode_cp(s)));
}

// throws if the domain name violates bidi rules
export function check_bidi(name) {
	let labels = name.split('.').map(explode_cp);
	if (labels.some(is_bidi_label)) {
		for (let cps of labels) {
			try {
				validate_bidi_label(cps);
			} catch (err) {
				throw new Error(`Disallowed bidi label "${escape_unicode(String.fromCodePoint(...cps))}": ${err.message}`);
			}
		}
	}	
}