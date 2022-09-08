// warning: Unicode support
// 14.0.0 expected
// 13.0.0 (node) appears to pass all tests
// 11.0.0 (node) fails 1 test

import {explode_cp, str_from_cps} from './utils.js';

export function nfc(cps) {
	return explode_cp(str_from_cps(cps).normalize('NFC'));
}

export function nfd(cps) {
	return explode_cp(str_from_cps(cps).normalize('NFD'));
}
