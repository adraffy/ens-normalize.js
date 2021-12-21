function norm(form, cps) {
	return [...String.fromCodePoint(...cps).normalize(form)].map(x => x.codePointAt(0));
}

// this is a polyfill for normalized forms
// which at the moment, this library costs 13KB
// however the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
export function nfc(cps) { return norm('NFC', cps); }
export function nfd(cps) { return norm('NFD', cps); }