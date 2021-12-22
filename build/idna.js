import {decode_payload, read_member_table, read_mapped_table, lookup_member, lookup_mapped} from './decoder.js';
import {escape_unicode} from './utils.js';
import PAYLOAD from './output/idna.js';

let r = decode_payload(PAYLOAD);
const COMBINING_MARKS = read_member_table(r);
const IGNORED = read_member_table(r);
const DISALLOWED = read_member_table(r);
const MAPPED = read_mapped_table(r);

export function is_disallowed(cp) {
	return lookup_member(DISALLOWED, cp);
}
export function is_ignored(cp) {
	return lookup_member(IGNORED, cp);
}
export function is_combining_mark(cp) {
	return lookup_member(COMBINING_MARKS, cp);
}

// note: we cant return the internal structure
// because it could be modified 
export function get_mapped(cp) {
	return lookup_mapped(MAPPED, cp)?.slice();
}

// this returns [[]] if empty
export function tokenized_idna(cps, validate = false, emoji_parser = false) {
	let chars = [];
	let tokens = [];
	let labels = [tokens];
	function drain() { 
		while (true) {
			let pos = chars.indexOf(0x2E); // split the chars at each stop
			if (pos == -1) break;
			if (pos > 0) tokens.push({t: chars.slice(0, pos)}); // before the stop
			tokens = [];  // create a new label
			labels.push(tokens);
			chars = chars.slice(pos + 1);
		}
		if (chars.length > 0) {
			tokens.push({t: chars}); // after the stop
			chars = [];
		}
	}
	for (let i = 0; i < cps.length; i++) {
		if (emoji_parser) {
			let [len, e] = emoji_parser(cps, i);
			if (len > 0) {
				drain();
				tokens.push({e}); // these are emoji tokens
				i += len - 1;
				continue;
			}
		} 
		let cp = cps[i];
		if (is_disallowed(cp)) {
			// disallowed: Leave the code point unchanged in the string, and record that there was an error.
			if (validate) break; // fail early
			throw new Error(`Disallowed character "${escape_unicode(String.fromCodePoint(cp))}"`);
		} else if (is_ignored(cp)) {
			// ignored: Remove the code point from the string. This is equivalent to mapping the code point to an empty string.		
			if (validate) break; // fail early
		} else if (validate) {
			// With either Transitional or Nontransitional Processing, sources already in Punycode are validated without mapping. 
			// In particular, Punycode containing Deviation characters, such as href="xn--fu-hia.de" (for fuß.de) is not remapped. 
			// This provides a mechanism allowing explicit use of Deviation characters even during a transition period. 
			chars.push(cp);
		} else {
			// mapped: Replace the code point in the string by the value for the mapping in Section 5, IDNA Mapping Table.
			// deviation: Leave the code point unchanged in the string.
			// valid: Leave the code point unchanged in the string.
			chars.push(...(lookup_mapped(MAPPED, cp) ?? [cp]));
		}
	}
	drain();
	return labels;
}