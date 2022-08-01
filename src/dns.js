// https://en.wikipedia.org/wiki/Domain_Name_System
// https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md

import {escape_unicode, explode_cp} from './utils.js';
import {puny_encode} from '@adraffy/punycode';

// lower-ascii DNS characters valid in IDNA 2003
const VALID = new Set(explode_cp('-.0123456789abcdefghijklmnopqrstuvwxyz'));

// [len, 63][len, 63][len, 63][len, 61][len, 0] = 255 
// 63+1+63+1+63+1+61 = 253
const MAX_NAME = 253; 
const MAX_LABEL = 63;

function label_error(label, message) {
	return new Error(`Invalid label "${escape_unicode(label)}": ${message}`);
}

// assume: name is from ens_normalize()
export function dns_from_normalized_ens(name) {	
	let acc = 0;
	return name.split('.').map((label, i) => {
		if (i > 0) acc++; // separator
		if (!label) return ''; // empty label
		let cps = explode_cp(label);
		let encoded = puny_encode(cps);
		if (encoded.length > MAX_LABEL) throw label_error(label, `too long`);
		for (let cp of encoded) {
			if (!VALID.has(cp)) {
				throw label_error(label, `invalid ASCII: "${escape_unicode(String.fromCodePoint(cp))}"`);
			}
		}
		acc += encoded.length;
		if (encoded === cps) {
			if (label.slice(2, 4) === '--') throw label_error(label, 'invalid label extension');
			if (label.startsWith('-')) throw label_error(label, 'leading hyphen');
			if (label.endsWith('-')) throw label_error(label, 'trailing hyphen');
		} else {
			acc += 4;
			label = 'xn--' + String.fromCodePoint(...encoded);
		}
		if (acc > MAX_NAME) throw new Error(`Name too long`);
		return label;
	}).join('.');
}