import {explode_cp} from './utils.js';

// this is a polyfill for normalized forms
// it exists because the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
// but lib-nf.js is approx 13KB as of 20211221

function norm(form, cps) {
	return explode_cp(String.fromCodePoint(...cps).normalize(form));
}

export function nfc(cps) { return norm('NFC', cps); }
export function nfd(cps) { return norm('NFD', cps); }