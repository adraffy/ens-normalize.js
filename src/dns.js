// https://en.wikipedia.org/wiki/Domain_Name_System
// https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md

import {escape_unicode, explode_cp} from './utils.js';
import {puny_encode} from '@adraffy/punycode';

// lower-ascii DNS characters valid in IDNA 2003
const VALID = new Set(explode_cp('-.0123456789abcdefghijklmnopqrstuvwxyz'));

const MAX_LABEL = 63;
// prefix-length form: [len:byte, label:[0, 63] bytes]+
// root label is implicit 0 length
// longest: [1,<61>][1,<63>][1,<63>][1,<63>][1,<0>]
// (1+61)+(1+63)+(1+63)+(1+63)+(1+0) = 255
// string form: "a.b.c"
// 63+1+63+1+63+1+61 = 253
const MAX_NAME = 253; 

// assume: name is from ens_normalize()
export function dns_from_normalized_ens(name) {	
	name = name.split('.').map(label0 => {
		if (!label0) return ''; // empty label
		let label = label0;
		try {
			let cps = explode_cp(label);
			let encoded = puny_encode(cps);
			for (let cp of encoded) {
				if (!VALID.has(cp)) {
					throw new Error(`invalid ASCII: "${escape_unicode(String.fromCodePoint(cp))}"`);
				}
			}
			if (encoded === cps) {
				if (label.startsWith('xn--')) throw new Error('punycode literal');
				if (label.slice(2, 4) === '--') throw new Error('invalid label extension');
				// above criteria are satisfied by ens_normalize_post_check()
				if (label.startsWith('-')) throw new Error('leading hyphen');
				if (label.endsWith('-')) throw new Error('trailing hyphen');
			} else {
				label = 'xn--' + String.fromCodePoint(...encoded); 
			}
			if (label.length > MAX_LABEL) throw new Error(`too long: ${label.length} > ${MAX_LABEL}`);
		} catch (err) {
			throw new Error(`Invalid label "${escape_unicode(label0)}": ${err.message}`);
		}
		return label;
	}).join('.');
	if (name.length > MAX_NAME) throw new Error(`Name too long: ${name.length} > ${MAX_NAME}`);
	return name;
}
