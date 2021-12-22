import {decode_payload, read_member_table, lookup_member} from './decoder.js';
import PAYLOAD from './output/emoji.js';

let r = decode_payload(PAYLOAD);
const REGIONAL = read_member_table(r);
const KEYCAP_OG = read_member_table(r);
const KEYCAP_FIXED = read_member_table(r);;
const EMOJI_OPT = read_member_table(r);
const EMOJI_REQ = read_member_table(r);
const MODIFIER = read_member_table(r);
const MODIFIER_BASE = read_member_table(r);
const TAG_SPEC = read_member_table(r);

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const KEYCAP_END = 0x20E3;
const TAG_END = 0xE007F;


function find_emoji_chr_mod_pre(cps, pos) {
	let cp = cps[pos];
	let cp2 = cps[pos+1]; // out of bounds, but unassigned
	// emoji_modifier_sequence => emoji_modifier_base emoji_modifier
	let base = lookup_member(MODIFIER_BASE, cp);
	if (base && cp2 && lookup_member(MODIFIER, cp2)) {
		return [2, [cp, cp2]];
	}
	// emoji_presentation_sequence => emoji_character \x{FE0F}
	let opt = base || lookup_member(EMOJI_OPT, cp); // these have optional FE0F that gets dropped
	let req = lookup_member(EMOJI_REQ, cp); // these require FE0F
	if (cp2 == FE0F && (opt || req)) {
		return [2, req ? [cp, FE0F] : [cp]];
	}
	// emoji_character 
	if (base || opt || lookup_member(REGIONAL, cp) || lookup_member(MODIFIER, cp)) {
		return [1, [cp]];	
	}
}

export function consume_emoji_sequence(cps, pos) {
	let cp = cps[pos];
	let len = cps.length;
	// [ED-14] emoji flag sequence
	// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
	// A sequence of two Regional Indicator characters, where the corresponding ASCII characters are valid region sequences as specified 
	if (pos+1 < len && lookup_member(REGIONAL, cp)) {
		// emoji_flag_sequence := regional_indicator regional_indicator
		let cp2 = cps[pos+1];
		if (lookup_member(REGIONAL, cp2)) {
			return [2, [cp, cp2]];
		}
	} 
	// [ED-14c] emoji keycap sequence
	// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
	// A sequence of the following form: 
	// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
	let keycap_og = lookup_member(KEYCAP_OG, cp);
	if (pos+1 < len && keycap_og && cps[pos+1] == KEYCAP_END) {
		return [2, [cp, KEYCAP_END]];
	} else if (pos+2 < len && (keycap_og || lookup_member(KEYCAP_FIXED, cp)) && cps[pos+1] == FE0F && cps[pos+2] == KEYCAP_END) {
		return [3, keycap_og ? [cp, KEYCAP_END] : [cp, FE0F, KEYCAP_END]];		
	}
	// [ED-15] emoji core sequence
	// emoji_core_sequence := emoji_character | emoji_presentation_sequence | emoji_keycap_sequence | emoji_modifier_sequence | emoji_flag_sequence 
	// [ED-15a] emoji zwj element
	// emoji_zwj_element := emoji_character | emoji_presentation_sequence | emoji_modifier_sequence
	// [ED-16] emoji zwj sequence 
	// emoji_zwj_sequence := emoji_zwj_element ( \x{200d} emoji_zwj_element )+
	// [ED-17] emoji sequence
	// emoji_sequence := emoji_core_sequence | emoji_zwj_sequence | emoji_tag_sequence 
	let emoji0 = find_emoji_chr_mod_pre(cps, pos);
	if (!emoji0) return [0];
	let [pos2, stack] = emoji0;
	pos2 += pos;
	let zwj = false;
	while (pos2+1 < len && cps[pos2] === ZWJ) {
		let emoji = find_emoji_chr_mod_pre(cps, pos2 + 1);
		if (!emoji) break;
		zwj = true;
		pos2 += 1 + emoji[0];
		stack.push(ZWJ, ...emoji[1]);
	}
	if (!zwj) {
		// [ED-14a] emoji tag sequence (ETS) 
		// https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence
		// A sequence of the following form:
		//  emoji_tag_sequence := tag_base tag_spec tag_end
		//   tag_base := emoji_character 
		//             | emoji_modifier_sequence     => emoji_modifier_base emoji_modifier
		//             | emoji_presentation_sequence => emoji_character \x{FE0F}
		//   tag_spec := [\x{E0020}-\x{E007E}]+
		//   tag_end  := \x{E007F}		
		if (pos2+2 < len && lookup_member(TAG_SPEC, cps[pos2])) {
			let pos3 = pos2 + 1;
			while (pos3+1 < len && lookup_member(TAG_SPEC, cps[pos3])) pos3++;
			if (cps[pos3++] == TAG_END) {
				// these are crazy dangerous because they don't render
				// ignore the sequence
				// return [pos3 - pos, stack.concat(cps.slice(pos2, pos3 - pos2))];
				return [pos3 - pos, stack];
			}
		}
	}
	return [pos2 - pos, stack];;
}