// reverse polyfill
// replace custom nf implementation with system implementation
// (saves approximately 6KB)

import {explodeCp, strFromCps} from './utils.js';

function nf(cps, form) {
	return explodeCp(strFromCps(cps).normalize(form));
}

export function nfc(cps) {
	return nf(cps, 'NFC');
}
export function nfd(cps) {
	return nf(cps, 'NFD');
}
