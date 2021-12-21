import {decode_payload, read_member_table, lookup_member} from './decoder.js';
import {escape_unicode} from './utils.js';
import PAYLOAD from './output/context.js';

let r = decode_payload(PAYLOAD);
const JOIN_T = read_member_table(r);
const JOIN_LD = read_member_table(r);
const JOIN_RD = read_member_table(r);
const VIRAMA = read_member_table(r);
const SCRIPT_GREEK = read_member_table(r);
const SCRIPT_HEBREW = read_member_table(r);
const SCRIPT_HKH = read_member_table(r);

export function validate_context(chunks) {
	// apply relative checks
	for (let cps of chunks) {
		for (let i = 0, e = cps.length - 1; i <= e; i++) {
			switch (cps[i]) {
				case 0x200C: { 
					// ZERO WIDTH NON-JOINER (ZWNJ)
					// ContextJ: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1	
					// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
					if (i > 0 && lookup_member(VIRAMA, cps[i - 1])) continue;
					// If RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D})) Then True;
					if (i > 0 && i < e) { // there is room on either side
						let head = i - 1;
						while (head > 0 && lookup_member(JOIN_T, cps[head])) head--; // T*
						if (lookup_member(JOIN_LD, cps[head])) { // L or D
							let tail = i + 1;
							while (tail < e && lookup_member(JOIN_T, cps[tail])) tail++; // T*
							if (lookup_member(JOIN_RD, cps[tail])) { // R or D
								continue;
							}
						}
					}
					break;
				}
				case 0x200D: {
					// ZERO WIDTH JOINER (ZWJ)
					// ContextJ: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
					// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
					if (i > 0 && lookup_member(VIRAMA, cps[i-1])) continue;
					break;
				}
				case 0x00B7: {
					// MIDDLE DOT
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
					// Between 'l' (U+006C) characters only, used to permit the Catalan
					// character ela geminada to be expressed.
					if (i > 0 && i < e && cps[i-1] == 0x6C && cps[i+1] == 0x6C) continue; 
					break;
				}
				case 0x0375: {
					// GREEK LOWER NUMERAL SIGN (KERAIA)
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.4
					// The script of the following character MUST be Greek.
					if (i < e && lookup_member(SCRIPT_GREEK, cps[i+1])) continue; 
					break;
				}
				case 0x05F3:
					// HEBREW PUNCTUATION GERESH
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.5
					// The script of the preceding character MUST be Hebrew.
				case 0x05F4: {
					// HEBREW PUNCTUATION GERSHAYIM
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.6		
					// The script of the preceding character MUST be Hebrew.
					if (i > 0 && lookup_member(SCRIPT_HEBREW, cps[i-1])) continue;
					break;
				}
				default: continue;
			}
			// the default behavior above is to continue if the context is valid
			// we only fall-through if no context was matched
			throw new Error(`No context for "${escape_unicode(String.fromCodePoint(cps[i]))}"`);
		}
	}
	// apply global checks
	let cps = chunks.flat();
	// 
	// ARABIC-INDIC DIGITS
	// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.8
	// Can not be mixed with Extended Arabic-Indic Digits.
	// For All Characters: If cp .in. 06F0..06F9 Then False; End For;
	// EXTENDED ARABIC-INDIC DIGITS
	// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.9
	// Can not be mixed with Arabic-Indic Digits.
	// For All Characters: If cp .in. 0660..0669 Then False; End For
	if (cps.some(cp => cp >= 0x0660 && cp <= 0x0669) && cps.some(cp => cp >= 0x06F0 && cp <= 0x06F9)) {
		throw new Error(`Disallowed arabic-indic digit mixture`);
	}
	// KATAKANA MIDDLE DOT
	// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.7
	// For All Characters: If Script(cp) .in. {Hiragana, Katakana, Han} Then True; End For;
	if (cps.includes(0x30FB) && !cps.every(cp => cp == 0x30FB || lookup_member(SCRIPT_HKH, cp))) {
		throw new Error(`Disallowed katakana`);
	}
}