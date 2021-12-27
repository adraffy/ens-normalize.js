import {read_member_set, read_zwj_seqs} from './decoder.js';
import { escape_unicode } from './utils.js';

// returns an emoji parser
export default function(r) {	
	const REGIONAL = read_member_set(r);
	const KEYCAP_DROP = read_member_set(r);
	const KEYCAP_REQ = read_member_set(r);
	const STYLE_DROP = read_member_set(r);
	const STYLE_REQ = read_member_set(r);
	const STYLE_OPT = read_member_set(r);
	const MODIFIER = read_member_set(r);
	const MODIFIER_BASE = read_member_set(r);
	const TAG_SPEC = read_member_set(r); 
	const ZWJ_SEQS = read_zwj_seqs(r, [...STYLE_DROP, ...STYLE_OPT].sort((a, b) => a - b));
	//const TAG_SPEC_VALID = read_member_function(r);
	
	const FE0F = 0xFE0F;
	const ZWJ = 0x200D;
	const KEYCAP_END = 0x20E3;
	const TAG_END = 0xE007F;

	function find_emoji_chr_mod_pre(cps, pos) {
		let cp = cps[pos];
		let cp2 = cps[pos+1]; // out of bounds, but unassigned
		// emoji_modifier_sequence := emoji_modifier_base emoji_modifier
		if (MODIFIER_BASE.has(cp) && cp2 && MODIFIER.has(cp2)) {
			return [2, [cp, cp2]];
		}
		// emoji_modifier_base is a emoji_character 
		// emoji_presentation_sequence := emoji_character \x{FE0F}
		// but some emoji dont need presentation
		// and previously valid emoji are already registered
		// we call these emoji optional
		if (cp2 == FE0F) {
			// these drop FE0F
			if (STYLE_DROP.has(cp)) return [2, [cp]];
			// these keep FE0F
			if (STYLE_OPT.has(cp) || STYLE_REQ.has(cp)) return [2, [cp, FE0F]]; 
		}
		// emoji_character 
		if (STYLE_DROP.has(cp) || STYLE_OPT.has(cp)) {
			return [1, [cp]];	
		}
	}

	return function(cps, pos) {
		let cp = cps[pos];
		let len = cps.length;
		// [ED-14] emoji flag sequence
		// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
		// A sequence of two Regional Indicator characters, where the corresponding ASCII characters are valid region sequences as specified 
		if (pos+2 <= len && REGIONAL.has(cp)) {
			// emoji_flag_sequence := regional_indicator regional_indicator
			let cp2 = cps[pos+1];
			if (REGIONAL.has(cp2)) {
				return [2, [cp, cp2]];
			} else if (!find_emoji_chr_mod_pre(cps, pos)) {
				// A singleton Regional Indicator character is not a well-formed emoji flag sequence.
				//throw new Error(`Invalid Emoji: ${cp}`);
				return [0];
			}
		} 
		// [ED-14c] emoji keycap sequence
		// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
		// A sequence of the following form: 
		// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
		let keycap_og = KEYCAP_DROP.has(cp);
		if (pos+2 <= len && keycap_og && cps[pos+1] == KEYCAP_END) {
			return [2, [cp, KEYCAP_END]];
		} else if (pos+3 <= len && (keycap_og || KEYCAP_REQ.has(cp)) && cps[pos+1] == FE0F && cps[pos+2] == KEYCAP_END) {
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
		let pos2 = emoji0[0] + pos;
		let stack = emoji0[1].slice(); // make a copy
		let zwj = false;
		while (pos2+1 < len && cps[pos2] === ZWJ) {
			let emoji = find_emoji_chr_mod_pre(cps, pos2 + 1);
			if (!emoji) break;
			zwj = true;
			pos2 += 1 + emoji[0];
			stack.push(ZWJ, ...emoji[1]);
		}
		if (zwj) {
			// the emoji sequence must be a member of ZWJ_SEQS
			let s = String.fromCodePoint(...stack);
			if (!ZWJ_SEQS.has(s.replace(/\u{FE0F}/gu, ''))) {
				//throw new Error(`Invalid Emoji Sequence: ${escape_unicode(s)}`);
				return emoji0;
			}
		} else {
			// [ED-14a] emoji tag sequence (ETS) 
			// https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence
			// A sequence of the following form:
			//  emoji_tag_sequence := tag_base tag_spec tag_end
			//   tag_base := emoji_character 
			//             | emoji_modifier_sequence     => emoji_modifier_base emoji_modifier
			//             | emoji_presentation_sequence => emoji_character \x{FE0F}
			//   tag_spec := [\x{E0020}-\x{E007E}]+
			//   tag_end  := \x{E007F}		
			if (pos2+2 < len && TAG_SPEC.has(cps[pos2])) {
				let pos3 = pos2 + 1;
				while (pos3+1 < len && TAG_SPEC.has(cps[pos3])) pos3++;
				if (cps[pos3++] == TAG_END) {
					//stack.push(...cps.slice(pos2, pos3 - pos2).filter(TAG_SPEC_VALID));
					return [pos3 - pos, stack];
				}
			}
		}
		return [pos2 - pos, stack];
	};
}