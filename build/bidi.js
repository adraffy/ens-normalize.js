import {decode_payload, read_member_table, lookup_member} from './decoder.js';
import PAYLOAD from './output/bidi.js';

let r = decode_payload(PAYLOAD);
const BIDI_R_AL = read_member_table(r);
const BIDI_L = read_member_table(r);
const BIDI_AN = read_member_table(r);
const BIDI_EN = read_member_table(r);
const BIDI_ECTOB = read_member_table(r);
const BIDI_NSM = read_member_table(r);

// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
// * The spec is ambiguious regarding when you can determine a domain name is bidi
// * According to IDNATestV2, this is calculated AFTER puny decoding
// https://unicode.org/reports/tr46/#Notation
// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN

export function is_bidi_label(cps) {
	return cps.some(cp => lookup_member(BIDI_R_AL, cp) || lookup_member(BIDI_AN, cp));
}

export function validate_bidi(cps) {
	if (cps.length == 0) return;
	// https://www.rfc-editor.org/rfc/rfc5893.txt
	// 1.) The first character must be a character with Bidi property L, R, 
	// or AL.  If it has the R or AL property, it is an RTL label; if it
	// has the L property, it is an LTR label.
	let last = cps.length - 1;
	if (lookup_member(BIDI_R_AL, cps[0])) { // RTL 
		// 2.) In an RTL label, only characters with the Bidi properties R, AL,
		// AN, EN, ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => lookup_member(BIDI_R_AL, cp) 
			|| lookup_member(BIDI_AN, cp)
			|| lookup_member(BIDI_EN, cp)
			|| lookup_member(BIDI_ECTOB, cp) 
			|| lookup_member(BIDI_NSM, cp))) throw new Error(`RTL: disallowed properties`);
		// 3. In an RTL label, the end of the label must be a character with
		// Bidi property R, AL, EN, or AN, followed by zero or more
		// characters with Bidi property NSM.
		while (lookup_member(BIDI_NSM, cps[last])) last--;
		last = cps[last];
		if (!(lookup_member(BIDI_R_AL, last) 
			|| lookup_member(BIDI_EN, last) 
			|| lookup_member(BIDI_AN, last))) throw new Error(`RTL: disallowed ending`);
		// 4. In an RTL label, if an EN is present, no AN may be present, and vice versa.
		let en = cps.some(cp => lookup_member(BIDI_EN, cp));
		let an = cps.some(cp => lookup_member(BIDI_AN, cp));
		if (en && an) throw new Error(`RTL: AN+EN`);
	} else if (lookup_member(BIDI_L, cps[0])) { // LTR
		// 5. In an LTR label, only characters with the Bidi properties L, EN,
		// ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => lookup_member(BIDI_L, cp) 
			|| lookup_member(BIDI_EN, cp)
			|| lookup_member(BIDI_ECTOB, cp)
			|| lookup_member(BIDI_NSM, cp))) throw new Error(`LTR: disallowed properties`);
		// 6. end with L or EN .. 0+ NSM
		while (lookup_member(BIDI_NSM, cps[last])) last--;
		last = cps[last];
		if (!lookup_member(BIDI_L, last) 
			&& !lookup_member(BIDI_EN, last)) throw new Error(`LTR: disallowed ending`);
	} else {
		throw new Error(`unknown direction`);
	}
}