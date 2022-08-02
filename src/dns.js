// https://en.wikipedia.org/wiki/Domain_Name_System
// https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md

import {escape_unicode, explode_cp} from './utils.js';
import {puny_encode} from '@adraffy/punycode';

// lower-ascii DNS characters valid in IDNA 2003
const VALID = new Set(explode_cp('-.0123456789abcdefghijklmnopqrstuvwxyz'));

const MAX_LABEL = 63;
// prefix-length form: [len:byte, label:[0, 63] bytes]+
// root label is implicit 0 length
// longest: [1,<61>] [1,<63>][1,<63>][1,<63>][1,<0>]
// (1+61)+(1+63)+(1+63)+(1+63)+(1+0) = 255
// string form: "a.b.c"
// 63+1+63+1+63+1+61 = 253
const MAX_NAME = 253; 

// assume: name is from ens_normalize()
export function dns_from_normalized_ens(name) {	
	let acc = 0;
	return name.split('.').map((label, i) => {
		if (i > 0) acc++; // separator
		if (!label) return ''; // empty label
		let cps = explode_cp(label);
		let encoded = puny_encode(cps);
		try {
			for (let cp of encoded) {
				if (!VALID.has(cp)) {
					throw new Error(`invalid ASCII: "${escape_unicode(String.fromCodePoint(cp))}"`);
				}
			}
			acc += encoded.length;
			if (encoded === cps) {
				if (label.startsWith('xn--')) throw new Error('punycode literal');
				if (label.slice(2, 4) === '--') throw Error('invalid label extension');
				if (label.startsWith('-')) throw Error('leading hyphen');
				if (label.endsWith('-')) throw Error('trailing hyphen');
			} else {
				acc += 4;
				label = 'xn--' + String.fromCodePoint(...encoded); 
			}
			if (label.length > MAX_LABEL) throw new Error(`too long`);
		} catch (err) {
			throw new Error(`Invalid label "${escape_unicode(label)}": ${err.message}`);
		}
		if (acc > MAX_NAME) throw new Error(`Name too long`);
		return label;
	}).join('.');
}