import {decode_payload, read_member_table, lookup_member} from './decoder.js';
import PAYLOAD from './output/emoji.js';

let r = decode_payload(PAYLOAD);
const DISALLOWED_IDNA2003 = read_member_table(r);
const REGIONAL = read_member_table(r);
const KEYCAP = read_member_table(r);
const EMOJI = read_member_table(r);
const MODIFIER = read_member_table(r);
const MODIFIER_BASE = read_member_table(r);
//const PRESENTATION = read_member_table(r);
//const TAG_SPEC = read_member_table(r);

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const KEYCAP_END = 0x20E3;
//const TAG_END = 0xE007F;

function find_emoji_chr_mod_pre(cps, pos) {
	let cp = cps[pos];
	let pos_last = cps.length - 1;
	// emoji_modifier_sequence => emoji_modifier_base emoji_modifier
	let base = lookup_member(MODIFIER_BASE, cp);
	if (pos < pos_last && base) {
		let next = cps[pos+1];
		if (lookup_member(MODIFIER, next)) {
			return [2, [cp, next]];
		}
	}
	// emoji_presentation_sequence => emoji_character \x{FE0F}
	let pres = lookup_member(EMOJI, cp);
	let was_dis = lookup_member(DISALLOWED_IDNA2003, cp);
	if (pos < pos_last && (pres || was_dis) && cps[pos+1] == FE0F) {
		return [2, was_dis ? [cp, FE0F] : [cp]];
	}
	// emoji_character 
	if (base || pres || lookup_member(REGIONAL, cp)) {
		return [1, [cp]];	
	}
}

// returns:
// success [eaten, well-formed, token]
// success [eaten, well-forced]  token = slice(eaten)
// failure []
export function consume_emoji_sequence(cps, pos) {
	let cp = cps[pos];
	let len = cps.length;
	// [ED-14] emoji flag sequence
	// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
	// A sequence of two Regional Indicator characters, where the corresponding ASCII characters are valid region sequences as specified 
	if (pos+1 < len && lookup_member(REGIONAL, cp)) {
		// emoji_flag_sequence := regional_indicator regional_indicator
		let next = cps[pos+1];
		if (lookup_member(REGIONAL, next)) {
			return [2, [cp, next]];
		}
	} 
	/*
	// [ED-14a] emoji tag sequence (ETS) 
	// https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence
	// A sequence of the following form:
	//  emoji_tag_sequence := tag_base tag_spec tag_end
	//   tag_base := emoji_character 
	//             | emoji_modifier_sequence     => emoji_modifier_base emoji_modifier
	//             | emoji_presentation_sequence => emoji_character \x{FE0F}
	//   tag_spec := [\x{E0020}-\x{E007E}]+
	//   tag_end  := \x{E007F}	
	if (cp == 0x1F3F4) { 
		// [Custom ENS Rule]
		// https://unicode.org/reports/tr51/#valid-emoji-tag-sequences
		// 0x1F3F4 + [E0030..E0039 E0061..E007A]+ 0xE007F
		let start = i;
		while (++i < e && is_alphanumeric_latin_tag(cps[i]));
		let seq = cps.slice(start, i + 1);
		if (cps[i] != TAG_END) throw new Error(`Invalid emoji tag sequence: "${qq(seq)}"`);
		ret.push(seq);
		continue;
	} 
	*/
	// [ED-14c] emoji keycap sequence
	// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
	// A sequence of the following form: 
	// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
	/*
	if (pos + 3 <= len && lookup_member(KEYCAP, cp) && cps[pos+1] == FE0F && cps[pos+2] == KEYCAP_END) {
		return [3, [cp, KEYCAP_END]];
	}
	*/
	if (pos+1 < len && lookup_member(KEYCAP, cp)) {
		let next = pos + 1;
		if (next+1 < len && cps[next] == FE0F) next++; // optional
		if (cps[next] == KEYCAP_END) {
			return [1 + next - pos, [cp, KEYCAP_END]];
		}
	}
	// [ED-17] emoji sequence
	// emoji_sequence := emoji_core_sequence | emoji_zwj_sequence | emoji_tag_sequence 
	// [ED-16] emoji zwj sequence 
	// emoji_zwj_sequence := emoji_zwj_element ( \x{200d} emoji_zwj_element )+
	// [ED-15a] emoji zwj element
	// emoji_zwj_element := emoji_character | emoji_presentation_sequence | emoji_modifier_sequence
	let emoji0 = find_emoji_chr_mod_pre(cps, pos);
	if (!emoji0) return [0];
	let [next, stack] = emoji0;
	next += pos;
	while (next + 1 < len && cps[next] === ZWJ) {
		let emoji = find_emoji_chr_mod_pre(cps, next + 1);
		if (!emoji) break;
		next += 1 + emoji[0];
		stack.push(ZWJ, ...emoji[1]);
	}
	return [next - pos, stack];
}