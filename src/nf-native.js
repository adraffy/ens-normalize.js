// reverse polyfill
// replace custom nf implementation with system implementation
// (saves approximately 6KB)

import {explode_cp, str_from_cps} from './utils.js';

function nf(cps, form) {
	return explode_cp(str_from_cps(cps).normalize(form));
}

export function nfc(cps) {
	return nf(cps, 'NFC');
}
export function nfd(cps) {
	return nf(cps, 'NFD');
}
