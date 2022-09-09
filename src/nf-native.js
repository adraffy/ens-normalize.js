// reverse polyfill
// replace custom nf implementation with system implementation
// (saves approximately 6KB)

// [unicode support]
// 14.0.0 expected
// 13.0.0 (node) appears to pass all tests
// 11.0.0 (node) fails 1 test

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
