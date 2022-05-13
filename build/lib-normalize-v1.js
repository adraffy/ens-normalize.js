import {read_member_set, read_mapped_table, lookup_mapped, read_tree, read_zero_terminated_array} from './decoder.js';
import {explode_cp, escape_unicode} from './utils.js';
import {parse_tokens} from './tokens.js';
import r from './output/v1.js';

const FCP = String.fromCodePoint.bind(String);

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const STOP = 0x2E;
const KEYCAP_END = 0x20E3;

const VALID = read_member_set(r);
const IGNORED = read_member_set(r);
const MAPPED = read_mapped_table(r);
const COMBINING_MARKS = read_member_set(r);

const KEYCAP_LEGACY = read_member_set(r);
const KEYCAP_REQ = read_member_set(r);
const STYLE_LEGACY = read_member_set(r);
const STYLE_REQ = read_member_set(r);
const MODIFIER = read_member_set(r);
const MODIFIER_BASE = read_member_set(r);

// whitelisted SEQ and ZWJ sequences are stored as trees
// they can be traversed character by character 
// failing to find a subtree or a match (terminal node) 
// implies a failure match

// SEQ are 1-character chains
const SEQ_ROOT = read_tree(r, x => Array(x()).fill(1)); 

// ZWJ are variable-character chains 
// index into emoji for extra compression (bound asserted during build)
const ZWJ_ROOT = read_tree(r, read_zero_terminated_array, [...STYLE_LEGACY, ...STYLE_REQ].sort((a, b) => a - b));

// trees are stored as nested objects
// "abc" => {a:{b:{c:{'':1}}}}
// empty string is a match (terminal node)
function has_own(obj, key = '') {
	return Object.hasOwn(obj, key);
}

// trees are traversed by string keys 
// composed of flattened codepoints 
// without emoji styling
function follow_zwj(parent, cps) {
	let key = FCP(...cps.filter(cp => cp != FE0F));
	if (has_own(parent, key)) return parent[key];
}

// https://unicode.org/reports/tr51/#def_emoji_modifier 
// emoji_modifier_base := \p{Emoji_Modifier_Base}
// emoji_modifier := \p{Emoji_Modifier}
// emoji_modifier_sequence := emoji_modifier_base emoji_modifier

// https://unicode.org/reports/tr51/#def_emoji_character
// emoji_character := \p{Emoji}
// emoji_presentation_selector := \x{FE0F}
// emoji_presentation_sequence := emoji_character emoji_presentation_selector

// read a single modifier or presentation sequence
// if found, return [consumed_length, parsed_codepoints]
// note: build-tables.js asserts that MODIFIER_BASE and MODIFIER are style-drop
function find_emoji_chr_mod_pre(cps, pos) {
	let a = cps[pos];
	if (!a) return;
	let b = cps[pos+1];
	if (MODIFIER_BASE.has(a) && MODIFIER.has(b)) return [2, [a, b]]; // modifier sequence
	if (STYLE_LEGACY.has(a)) return [b === FE0F ? 2 : 1, [a]]; // style is optional but dropped
	if (STYLE_REQ.has(a) && b === FE0F) return [2, [a, FE0F]]; // style is required
}

/*
// this is an alternative implementation
// which allows styling around modifier sequences

// read a single emoji character
// if found, return [consumed_length, parsed_codepoints]
function find_emoji_styled(cps, pos) {
	let cp = cps[pos];
	if (!cp) return;
	let styled = cps[pos+1] === FE0F;
	if (STYLE_LEGACY.has(cp)) return [styled ? 2 : 1, [cp]]; // style is optional but dropped
	if (STYLE_REQ.has(cp) && styled) return [2, [cp, FE0F]]; // style is required
}

// read a single modifier or presentation sequence
// if found, return [consumed_length, parsed_codepoints]
function find_emoji_chr_mod_pre(cps, pos) {
	let a = find_emoji_styled(cps, pos);
	if (a && MODIFIER_BASE.has(a[1][0])) { // could be emoji_modifier_sequence...
		let b = find_emoji_styled(cps, pos + a[0]);
		if (b && MODIFIER.has(b[1][0])) {
			return [a[0] + b[0], [...a[1], ...b[1]]]; // concat
		}
	}
	return a;
}
*/

// read a complex emoji
// always returns [consumed_length, parsed_codepoints?]
function parse_emoji(cps, pos0) {
	let cp0 = cps[pos0];

	// check for SEQ match
	let seq_key = FCP(cp0);
	if (has_own(SEQ_ROOT, seq_key)) { // potential match
		let node = SEQ_ROOT[seq_key];
		let pos = pos0 + 1; // check remaining chars
		while (true) {
			let cp = cps[pos];
			if (!cp) break; // end of string
			let key = FCP(cp);
			if (!has_own(node, key)) break; // no more possibilities
			node = node[key];
			pos++;
		}
		if (has_own(node)) { // this was a terminator
			return [pos - pos0, cps.slice(pos0, pos)];
		}
	}

	let cp1 = cps[pos0+1];
	
	// emoji flag sequence
	// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
	// regional_indicator := \p{Regional_Indicator}
	// emoji_flag_sequence := regional_indicator regional_indicator  
	// *** NOT PROCESSED *** 
	// instead single regional_indicator are allowed (they are just emoji)
	
	// emoji keycap sequence
	// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
	// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
	let keycap_og = KEYCAP_LEGACY.has(cp0);
	if (keycap_og && cp1 === KEYCAP_END) {
		return [2, [cp0, KEYCAP_END]];
	} else if ((keycap_og || KEYCAP_REQ.has(cp0)) && cp1 === FE0F && cps[pos0+2] === KEYCAP_END) {
		return [3, keycap_og ? [cp0, KEYCAP_END] : [cp0, FE0F, KEYCAP_END]];		
	}

	// emoji core sequence
	// https://unicode.org/reports/tr51/#def_emoji_core_sequence 
	// emoji_core_sequence := emoji_keycap_sequence | emoji_flag_sequence | chr_mod_pre
	// chr_mod_pre = emoji_character | emoji_presentation_sequence | emoji_modifier_sequence
	let emoji0 = find_emoji_chr_mod_pre(cps, pos0); 
	if (!emoji0) return [0];

	// emoji sequence 
	// https://unicode.org/reports/tr51/#def_emoji_sequence
	// emoji_sequence := chr_mod_pre | emoji_zwj_sequence | emoji_tag_sequence 
	
	// https://unicode.org/reports/tr51/#def_emoji_zwj_sequence
	// emoji_zwj_element := emoji_character | emoji_presentation_sequence | emoji_modifier_sequence		
	// emoji_zwj_sequence := emoji_zwj_element ( \x{200d} emoji_zwj_element )+		
		
	let [n0, v0] = emoji0;
	let pos1 = pos0 + n0;
	cp1 = cps[pos1]; // the character following the emoji we just parsed
	if (cp1 === ZWJ) { // potential match
		let node = follow_zwj(ZWJ_ROOT, v0); 
		if (node) { // whitelisted
			let queue = [];
			let pos = pos1;
			let pos_last;
			while (cps[pos++] === ZWJ) { // zwj?
				let emoji = find_emoji_chr_mod_pre(cps, pos); // zwj+emoji?
				if (!emoji) break;
				let [n, v] = emoji;
				node = follow_zwj(node, v); // traverse the tree
				if (!node) break;
				pos += n; 
				queue.push(ZWJ, ...v); // save chars that dont form a complete sequence yet
				if (has_own(node)) { // this is a valid sequence
					v0.push(...queue); // drain queue
					queue.length = 0;
					pos_last = pos;
				}
			}
			if (pos_last) {
				// v0 correponds to the longest zwj sequence that matched
				return [pos_last - pos0, v0];
			}
		}
	}

	// emoji tag sequence
	// https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence
	// emoji_tag_sequence := tag_base tag_spec tag_end
	// tag_base := emoji_character 
	//           | emoji_modifier_sequence     => emoji_modifier_base emoji_modifier
	//           | emoji_presentation_sequence => emoji_character \x{FE0F}
	// tag_spec := [\x{E0020}-\x{E007E}]+
	// tag_end  := \x{E007F}		
	// *** NOT PROCESSED *** 
	// these are allowed via SEQ

	return emoji0;
}

// ************************************************************
// from nf.js
const COMBINING_RANK = Array(r()).fill().map(() => read_member_set(r));
const DECOMP = read_mapped_table(r);
const COMP_EXCLUSIONS = read_member_set(r);

const S0 = 0xAC00;
const L0 = 0x1100;
const V0 = 0x1161;
const T0 = 0x11A7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;
const S1 = S0 + S_COUNT;
const L1 = L0 + L_COUNT;
const V1 = V0 + V_COUNT;
const T1 = T0 + T_COUNT;
function is_hangul(cp) {
	return cp >= S0 && cp < S1;
}

function decompose(cp, next) {
	if (cp < 0x80) {
		next(cp);
	} else if (is_hangul(cp)) {
		let s_index = cp - S0;
		let l_index = s_index / N_COUNT | 0;
		let v_index = (s_index % N_COUNT) / T_COUNT | 0;
		let t_index = s_index % T_COUNT;
		next(L0 + l_index);
		next(V0 + v_index);
		if (t_index > 0) next(T0 + t_index);
	} else {
		let mapped = lookup_mapped(DECOMP, cp);
		if (mapped) {
			for (let cp of mapped) {
				decompose(cp, next);
			}
		} else {
			next(cp);
		}
	}
}
function compose_pair(a, b) {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) { // LV
		let l_index = a - L0;
		let v_index = b - V0;
		let lv_index = l_index * N_COUNT + v_index * T_COUNT;
		return S0 + lv_index;
	} else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
		return a + (b - T0);
	} else {
		for (let [combined, v] of DECOMP) {		
			if (v.length == 2 && v[0] == a && v[1] == b) {
				if (COMP_EXCLUSIONS.has(combined)) break;
				return combined;
			}
		}
	}
	return -1;
}
function decomposer(cps, callback) {
	let stack = [];
	cps.forEach(cp => decompose(cp, next));
	drain();
	function drain() {
		stack.sort((a, b) => a[0] - b[0]).forEach(([rank, cp]) => callback(rank, cp));
		stack.length = 0;
	}
	function next(cp) {
		let rank = 1 + COMBINING_RANK.findIndex(table => table.has(cp));
		if (rank == 0) {
			drain();
			callback(rank, cp);
		} else {
			stack.push([rank, cp]);
		}
	}
}
function nfc(cps) {
	let ret = [];
	let stack = [];
	let prev_cp = -1;
	let prev_rank = 0;
	decomposer(cps, next);
	if (prev_cp >= 0) ret.push(prev_cp);
	ret.push(...stack);	
	return ret;
	function next(rank, cp) {
		if (prev_cp === -1) {
			if (rank == 0) {
				prev_cp = cp;
			} else {
				ret.push(cp);
			}
		} else if (prev_rank > 0 && prev_rank >= rank) {
			if (rank == 0) {
				ret.push(prev_cp, ...stack);
				stack.length = 0;
				prev_cp = cp;
			} else {
				stack.push(cp);
			}
			prev_rank = rank;
		} else {
			let composed = compose_pair(prev_cp, cp);
			if (composed >= 0) {
				prev_cp = composed;
			} else if (prev_rank == 0 && rank == 0) {
				ret.push(prev_cp);
				prev_cp = cp;
			} else {
				stack.push(cp);
				prev_rank = rank;
			}
		}
	}
}

// ************************************************************
// from context.js

const VIRAMA = COMBINING_RANK[r()]; // index into virama class
const JOIN_T = read_member_set(r);
const JOIN_LD = read_member_set(r);
const JOIN_RD = read_member_set(r);
const SCRIPT_GREEK = read_member_set(r);
const SCRIPT_HEBREW = read_member_set(r);
const SCRIPT_HKH = read_member_set(r);

// apply ContextJ filtering
function filter_contextJ(cps) {
	return cps.filter((cp, i) => {
		if (cp === 0x200C) {
			// ZERO WIDTH NON-JOINER (ZWNJ)
			// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1	
			// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
			if (i > 0 && VIRAMA.has(cps[i - 1])) return;
			// If RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D})) Then True;
			let e = cps.length - 1;
			if (i > 0 && i < e) { // there is room on either side
				let head = i - 1;
				while (head > 0 && JOIN_T.has(cps[head])) head--; // T*
				if (JOIN_LD.has(cps[head])) { // L or D
					let tail = i + 1;
					while (tail < e && JOIN_T.has(cps[tail])) tail++; // T*
					if (JOIN_RD.has(cps[tail])) { // R or D
						return;
					}
				}
			}
			throw new Error(`No context for ZWNJ`);
		} else if (cp === ZWJ) {
			// ZERO WIDTH JOINER (ZWJ)
			// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
			if (i > 0 && VIRAMA.has(cps[i-1])) return;
			throw new Error(`No context for ZWJ`);
		}
		return true;
	});
}

// apply ContextO rules
function validate_contextO(cps) {
	for (let i = 0, e = cps.length - 1; i <= e; i++) {
		switch (cps[i]) {			
			case 0xB7: {
				// MIDDLE DOT
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
				// Between 'l' (U+006C) characters only, used to permit the Catalan
				// character ela geminada to be expressed.
				if (i > 0 && i < e && cps[i-1] == 0x6C && cps[i+1] == 0x6C) continue; 
				break;
			}
			case 0x375: {
				// GREEK LOWER NUMERAL SIGN (KERAIA)
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.4
				// The script of the following character MUST be Greek.
				if (i < e && SCRIPT_GREEK.has(cps[i+1])) continue; 
				break;
			}
			case 0x5F3:
				// HEBREW PUNCTUATION GERESH
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.5
				// The script of the preceding character MUST be Hebrew.
			case 0x5F4: {
				// HEBREW PUNCTUATION GERSHAYIM
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.6		
				// The script of the preceding character MUST be Hebrew.
				if (i > 0 && SCRIPT_HEBREW.has(cps[i-1])) continue;
				break;
			}
			default: continue;
		}
		// the default behavior above is to continue if the context is valid
		// we only fall-through if no context was matched
		throw new Error(`No context for "${escape_unicode(FCP(cps[i]))}"`);
	}
	// ARABIC-INDIC DIGITS
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.8
	// Can not be mixed with Extended Arabic-Indic Digits.
	// For All Characters: If cp .in. 06F0..06F9 Then False; End For;
	// EXTENDED ARABIC-INDIC DIGITS
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.9
	// Can not be mixed with Arabic-Indic Digits.
	// For All Characters: If cp .in. 0660..0669 Then False; End For
	if (cps.some(cp => cp >= 0x660 && cp <= 0x669) && cps.some(cp => cp >= 0x6F0 && cp <= 0x6F9)) {
		throw new Error(`Disallowed arabic-indic digit mixture`);
	}
	// KATAKANA MIDDLE DOT
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.7
	// The effect of this rule is to require at least one character in the label to be in one of those scripts.
	// For All Characters: If Script(cp) .in. {Hiragana, Katakana, Han} Then True; End For;
	if (cps.includes(0x30FB) && !cps.some(cp => SCRIPT_HKH.has(cp))) {
		throw new Error(`Disallowed katakana`);
	}
}

// ************************************************************
// from bidi.js

const R_AL = read_member_set(r);
const L = read_member_set(r);
const AN = read_member_set(r);
const EN = read_member_set(r);
const ECTOB = read_member_set(r); // ES, CS, ET, ON, BN
const NSM = read_member_set(r);

function is_bidi_label(cps) {
	return cps.some(cp => R_AL.has(cp) || AN.has(cp));
}

function validate_bidi_label(cps) {
	// https://www.rfc-editor.org/rfc/rfc5893.txt
	// 1.) The first character must be a character with Bidi property L, R, 
	// or AL.  If it has the R or AL property, it is an RTL label; if it
	// has the L property, it is an LTR label.
	let last = cps.length - 1;
	if (R_AL.has(cps[0])) { // RTL 
		// 2.) In an RTL label, only characters with the Bidi properties R, AL, AN, EN, ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => R_AL.has(cp) || AN.has(cp) || EN.has(cp) || ECTOB.has(cp) || NSM.has(cp))) throw new Error(`RTL: disallowed properties`);
		// 3. In an RTL label, the end of the label must be a character with
		// Bidi property R, AL, EN, or AN, followed by zero or more
		// characters with Bidi property NSM.
		while (NSM.has(cps[last])) last--;
		last = cps[last];
		if (!(R_AL.has(last) || EN.has(last) || AN.has(last))) throw new Error(`RTL: disallowed ending`);
		// 4. In an RTL label, if an EN is present, no AN may be present, and vice versa.
		if (cps.some(cp => EN.has(cp)) && cps.some(cp => AN.has(cp))) throw new Error(`RTL: AN+EN`);
	} else if (L.has(cps[0])) { // LTR
		// 5. In an LTR label, only characters with the Bidi properties L, EN, ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => L.has(cp) || EN.has(cp) || ECTOB.has(cp) || NSM.has(cp))) throw new Error(`LTR: disallowed properties`);
		// 6. end with L or EN .. 0+ NSM
		while (NSM.has(cps[last])) last--;
		last = cps[last];
		if (!L.has(last) && !EN.has(last)) throw new Error(`LTR: disallowed ending`);
	} else if (cps.every(cp => AN.has(cp))) { 
		// raffy modification:
		// the directionality of a fully AN label is irrelevant
	} else {
		throw new Error(`unknown direction`);
	}
}

// ************************************************************

// Primary API
// throws TypeError if not a string
// throws Error if not normalizable
// return string ready for namehash
export function ens_normalize(name) {
	if (/^[0-9a-z\.\-]+$/iu.test(name)) { // fast path
		return name.toLowerCase();
	}
	let labels = parse_tokens(nfc(explode_cp(name)), cp => {
		if (STOP == cp) return; // create a new label
		if (IGNORED.has(cp)) return []; // 0 char
		if (VALID.has(cp)) return [cp]; // 1 char
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return mapped; // 1+ chars
		throw new Error(`Disallowed character "${escape_unicode(FCP(cp))}"`);
	}, parse_emoji).map(tokens => {
		let cps = []; // output code points
		let text = []; // textual code points
		for (let {e, v} of tokens) {
			if (v) {
				v = filter_contextJ(v); // ContextJ
				cps.push(...v);
				text.push(...v);
			} else {
				if (text.length > 0) { 
					// emoji at the start of the label are ignored until text is produced
					// afterwards, emoji are replaced by FE0F (which is NSM) 
					// (acts like a separator)
					text.push(FE0F); 
				}
				cps.push(...e);
			}
		}
		return {text, cps};
	});
	// https://unicode.org/reports/tr46/#Notation
	// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN
	let check_bidi = labels.some(x => is_bidi_label(x.text));
	return labels.map(({cps, text}) => {
		if (cps.length > 0) {
			if (COMBINING_MARKS.has(cps[0])) {
				throw label_error(cps, `leading combining mark`);
			}
			try {
				validate_contextO(text); // ContextO
				if (check_bidi) {
					validate_bidi_label(text); // CheckBidi
				}
			} catch (err) {
				throw label_error(cps, err.message);
			}
		}
		return FCP(...cps);
	}).join(FCP(STOP));
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R💩affy.eth"
// this is much nicer than exposing the predicates
// [{m:[0x72], u:[0x52]},{e:[0x1F4A9],u:[0x1F4A9]},{t:[61,66,66]},{},{t:[65,74,68]}]
export function ens_tokenize(name) {
	return parse_tokens(nfc(explode_cp(name)), cp => {
		if (STOP == cp) return {}; // stop 
		if (VALID.has(cp)) return [cp]; // this gets merged into v
		if (IGNORED.has(cp)) return {i: cp}; // ignored 
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; // mapped (u = before)
		return {d: cp}; // disallowed
	}, parse_emoji)[0]; // emoji (u = before)
}

function label_error(cps, message) {
	return new Error(`Disallowed label "${escape_unicode(FCP(...cps))}": ${message}`);
}