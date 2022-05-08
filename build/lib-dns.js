// https://en.wikipedia.org/wiki/Domain_Name_System
// https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md

import {explode_cp, escape_unicode} from './utils.js';
import {puny_encode} from './puny.js';

import VALID_STR from './output/dns.js';

// lower-ascii characters valid in IDNA 2003/2008
const VALID = new Set(explode_cp(VALID_STR));

const STOP = '.';
const HYPHEN = 0x2D;

const MAX_NAME = 253; // u16(len) + 253
const MAX_LABEL = 63;

function label_error(cps, message) {
	return new Error(`Invalid label "${escape_unicode(String.fromCodePoint(...cps))}": ${message}`);
}

export function dns_from_normalized_ens(name) {	
	let acc = 0;
	return name.split(STOP).map((label, i) => {
		if (i > 0) acc++; // separator
		if (!label) return ''; // empty label
		let cps = explode_cp(label);
		let len = cps.length;
		if (cps[0] == HYPHEN) throw label_error(cps, `leading hyphen`);
		if (len >= 2 && cps[len - 1] == HYPHEN) throw label_error(cps, `trailing hyphen`);
		if (len >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) throw label_error(cps, `invalid label extension`);		
		//if (len > MAX_LABEL) throw label_error(cps, `too long`);
		let encoded = puny_encode(cps, true);
		if (encoded.length > MAX_LABEL) throw label_error(cps, `too long`);
		if (encoded.some(cp => !VALID.has(cp))) throw label_error(cps, 'invalid ASCII');
		acc += encoded.length;
		if (acc > MAX_NAME) throw new Error(`Name too long`);		
		return String.fromCodePoint(...encoded);
	}).join(STOP);
}