// https://en.wikipedia.org/wiki/Domain_Name_System
// https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md

import {explode_cp, escape_unicode, hex_cp, quote_cp} from './utils.js';
import {puny_encode} from './puny.js';

import VALID_STR from './output/dns.js';

// lower-ascii characters valid in IDNA 2003/2008
const VALID = new Set(explode_cp(VALID_STR));

// [len, 63][len, 63][len, 63][len, 61][len, 0] = 255 
// 63+1+63+1+63+1+61 = 253
const MAX_NAME = 253; 
const MAX_LABEL = 63;

function label_error(s, message) {
	return new Error(`Invalid label "${escape_unicode(s)}": ${message}`);
}

// assume: name is from ens_normalize()
export function dns_from_normalized_ens(name) {	
	let acc = 0;
	return name.split('.').map((label, i) => {
		if (i > 0) acc++; // separator
		if (!label) return ''; // empty label
		if (/^xn--/i.test(label)) throw label_error(label, `literal punycode`);
		if (label.startsWith('-')) throw label_error(label, 'leading hyphen');
		if (label.endsWith('-')) throw label_error(label, 'trailing hyphen');
		let cps = explode_cp(label);
		let encoded = puny_encode(cps);
		if (encoded.length > MAX_LABEL) throw label_error(label, `too long`);
		for (let cp of encoded) {
			if (!VALID.has(cp)) {
				throw label_error(label, `invalid ASCII: "${escape_unicode(String.fromCodePoint(cp))}"`);
			}
		}
		if (encoded.some(cp => !VALID.has(cp))) 
		acc += encoded.length;
		if (acc > MAX_NAME) throw new Error(`Name too long`);
		return encoded === cps ? label : 'xn--' + String.fromCodePoint(...encoded);
	}).join('.');
}