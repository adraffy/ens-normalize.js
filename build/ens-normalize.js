//IGNORE
// kludge to make the file runnable as-is
import {readFileSync} from 'fs';
import {arithmetic_decoding} from './decoder.js';
function compressed() {
	let params = `-nfc=true-bidi=true`;
	return arithmetic_decoding(readFileSync(new URL(`output/arithmetic${params}.bin`, import.meta.url).pathname));
	//return JSON.parse(readFileSync(new URL(`output/values${params}.json`, import.meta.url).pathname));
}
//~IGNORE

import {Decoder, lookup_mapped, lookup_member} from './decoder.js';
import {escape_unicode, split_on} from './utils.js';

// compressed lookup tables
let r = new Decoder(compressed());
const COMBINING_MARKS = r.read_member_table();
const IGNORED = r.read_member_table();
const DISALLOWED = r.read_member_table();
const JOIN_T = r.read_member_table();
const JOIN_LD = r.read_member_table();
const JOIN_RD = r.read_member_table();
const MAPPED = r.read_mapped_table();
const ZWNJ_EMOJI = r.read_emoji();
const COMBINING_RANK = r.read_member_tables(1 + r.read());
const VIRAMA = COMBINING_RANK[r.read()];
const DECOMP = r.read_mapped_table();
const COMP_EXCLUSIONS = r.read_member_table();
const BIDI_R_AL = r.read_member_table();
const BIDI_L = r.read_member_table();
const BIDI_AN = r.read_member_table();
const BIDI_EN = r.read_member_table();
const BIDI_ECTOB = r.read_member_table();
const BIDI_NSM = r.read_member_table();

// ************************************************************
// normalization forms

// algorithmic hangul
// https://www.unicode.org/versions/Unicode14.0.0/ch03.pdf
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
				if (lookup_member(COMP_EXCLUSIONS, combined)) break;
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
		let rank = 1 + COMBINING_RANK.findIndex(table => lookup_member(table, cp));
		if (rank == 0) {
			drain();
			callback(rank, cp);
		} else {
			stack.push([rank, cp]);
		}
	}
}

export function nfd(cps) {
	let ret = [];
	decomposer(cps, (_, cp) => ret.push(cp));
	return ret;
}

export function nfc(cps) {
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

function puny_decode(cps) {
	// https://datatracker.ietf.org/doc/html/rfc3492
	// adapted from https://github.com/mathiasbynens/punycode.js
	// puny format: "xn--{ascii}-{0-9a-z}"
	// this function receives normalized cps such that:
	// * no uppercase 
	// * no overflow (#section-6.4)
	let ret = [];
	let pos = cps.lastIndexOf(0x2D); // hyphen
	for (let i = 0; i < pos; i++) {
		let cp = cps[i];
		if (cp >= 0x80) throw new Error('expected ASCII');
		ret.push(cp);
	}
	pos++; // skip hyphen
	// #section-5
	const BASE = 36; 
	const T_MIN = 1;
	const T_MAX = 26;
	const SKEW = 38;
	const DAMP = 700;
	const MAX_DELTA = (BASE - T_MIN) * T_MAX >> 1;
	let i = 0, n = 128, bias = 72;
	while (pos < cps.length) {
		let prev = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (pos >= cps.length) throw new Error(`invalid encoding`);
			let cp = cps[pos++];
			if (cp >= 0x30 && cp <= 0x39) { // 0-9
				cp -= 0x16; // 26 + (code - 0x30)
            } else if (cp >= 0x61 && cp <= 0x7A) { // a-z
				cp -= 0x61;
			} else {
				throw new Error(`invalid character ${cp}`);
			}
			i += cp * w;
			const t = k <= bias ? T_MIN : (k >= bias + T_MAX ? T_MAX : k - bias);
			if (cp < t) break;
			w *= BASE - t;
		}
        let len = ret.length + 1;
        let delta = prev == 0 ? (i / DAMP)|0 : (i - prev) >> 1;
		delta += (delta / len)|0;
		let k = 0;
		for (; delta > MAX_DELTA; k += BASE) {
			delta = (delta / (BASE - T_MIN))|0;
		}
		bias = (k + (BASE - T_MIN + 1) * delta / (delta + SKEW))|0;
        n += (i / len)|0;
		i %= len;
		ret.splice(i++, 0, n);
	}	
	return ret;
}

// ************************************************************

function is_zwnj_emoji(v, pos) {
	let {length} = v;
	for (let b = Math.min(pos, ZWNJ_EMOJI.length); b > 0; b--) {
		let bucket = ZWNJ_EMOJI[b];
		if (!bucket) continue;
		next: for (let emoji of bucket) { // TODO: early abort 
			let i = pos - b;
			for (let c of emoji) {
				if (i >= length) continue next;
				let ci = v[i];			
				if (ci === 0xFE0F) { // this could be is_ignored()
					i++; // skip
					continue;
				} else if (c != v[i++]) {
					continue next;
				}
			}
			return true;
		}
	}
	return false;
}

export function is_disallowed(cp) {
	return lookup_member(DISALLOWED, cp);
}
export function is_ignored(cp) {
	return lookup_member(IGNORED, cp);
}
export function get_mapped(cp) {
	return lookup_mapped(MAPPED, cp)?.slice();
}

export class DisallowedLabelError extends Error {
	constructor(message, cps) {
		super(`Disallowed label "${escape_unicode(String.fromCodePoint(...cps))}": ${message}`);
		this.codePoints = cps;
	}
}
export class DisallowedCharacterError extends Error {
	constructor(cp, desc = '') {
		super(`Disallowed character "${escape_unicode(String.fromCodePoint(cp))}"` + (desc ? `: ${desc}` : ''));
		this.codePoint = cp;
	}
}

// never throws if ignore_disallowed
function nfc_idna_contextj_emoji(cps, ignore_disallowed = false) {
	const empty = [];
	return nfc(cps.map((cp, i) => {
		// disallowed: Leave the code point unchanged in the string, and record that there was an error.
		if (is_disallowed(cp)) {
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp);
		}
		// ignored: Remove the code point from the string. This is equivalent to mapping the code point to an empty string.
		if (is_ignored(cp)) return empty;
		if (cp === 0x200C) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
			// 1.) V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(VIRAMA, cps[i - 1])) return cp; // allowed
			// 2.) {L,D} + T* + cp + T* + {R,D}
			// L,D,T,R = Joining_Type
			if (i > 0 && i < cps.length - 1) { // there is room on either side
				let head = i - 1;
				while (head > 0 && lookup_member(JOIN_T, cps[head])) head--; // T*
				if (lookup_member(JOIN_LD, cps[head])) { // L or D
					let tail = i + 1;
					while (tail < cps.length - 1 && lookup_member(JOIN_T, cps[tail])) tail++; // T*
					if (lookup_member(JOIN_RD, cps[tail])) { // R or D
						return cp; // allowed
					}
				}
			}
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp, `ZWJ outside of context`);
		} else if (cp === 0x200D) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// 1.) V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(VIRAMA, cps[i - 1])) return cp; // allowed
			// [Custom ENS Rule] Emoji
			if (is_zwnj_emoji(cps, i)) return cp; // allowed
			if (ignore_disallowed) return empty; 
			throw new DisallowedCharacterError(cp, `ZWNJ outside of context`);
		}
		// mapped: Replace the code point in the string by the value for the mapping in Section 5, IDNA Mapping Table.
		// deviation: Leave the code point unchanged in the string.
		// valid: Leave the code point unchanged in the string.
		return lookup_mapped(MAPPED, cp) ?? cp;
	}).flat());
}

// Primary API
// throws TypeError if not a string
// throws DisallowedLabelError/DisallowedCharacterError if not normalizable
// returns a string ready for namehash
export function ens_normalize(name, ignore_disallowed = false, check_bidi = false) { 
	// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
	// "UTS46 with the options transitional=false and useSTD3AsciiRules=true."
	// see: build-tables.js
	// assumptions:
	// * CheckHyphens = true
	// * CheckJoiners = true
	// * CheckBidi = unknown
	const STOP = 0x2E;
	const HYPHEN = 0x2D;	
	// https://unicode.org/reports/tr46/#Processing
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// [Processing] 1.) Map
	// [Processing] 2.) Normalize
	// [Processing] 3.) Break
	let labels = split_on(nfc_idna_contextj_emoji([...name].map(x => x.codePointAt(0), ignore_disallowed)), STOP).map(cps => {		
		// [Processing] 4.) Convert/Validate
		if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) { // "**--"
			if (cps[0] == 0x78 && cps[1] == 0x6E) { // "xn--"
				// Attempt to convert the rest of the label to Unicode according to Punycode [RFC3492].
				// If that conversion fails, record that there was an error, and continue with the next label.
				let puny;
				try {
					puny = puny_decode(cps.slice(4));
				} catch (err) {
					throw new DisallowedLabelError(`punycode: ${err.message}`, cps);
				}
				// With either Transitional or Nontransitional Processing, sources already in Punycode are validated without mapping. 
				// In particular, Punycode containing Deviation characters, such as href="xn--fu-hia.de" (for fuß.de) is not remapped. 
				// This provides a mechanism allowing explicit use of Deviation characters even during a transition period. 
				// [Custom ENS Rule] deviate from UTS-46 and remap
				let idna = nfc_idna_contextj_emoji(puny, true);
				if (puny.length != idna.length || !puny.every((x, i) => x == idna[i])) throw new DisallowedLabelError(`puny not idna`, cps);
				// Otherwise replace the original label in the string by the results of the conversion. 
				cps = puny;
			}
		}
		return cps;
	});
	for (let cps of labels) {	
		if (cps.length == 0) continue;
		// [Validity] 1.) The label must be in Unicode Normalization Form NFC.
		// => satsified by nfc_idna()
		// [Validity] 2.) If CheckHyphens, the label must not contain a U+002D HYPHEN-MINUS character in both the third and fourth positions.
		// note: we check this here because puny can expand into "aa--bb"
		if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) throw new DisallowedLabelError(`invalid label extension`, cps);
		// [Validity] 3.) If CheckHyphens, the label must neither begin nor end with a U+002D HYPHEN-MINUS character.
		if (cps[0] == HYPHEN) throw new DisallowedLabelError(`leading hyphen`, cps);
		if (cps[cps.length - 1] == HYPHEN) throw new DisallowedLabelError(`trailing hyphen`, cps);		
		// [Validity] 4.) The label must not contain a U+002E ( . ) FULL STOP.
		// => satisfied by [Processing] 3.) Break
		// [Validity] 5.) The label must not begin with a combining mark, that is: General_Category=Mark.
		if (lookup_member(COMBINING_MARKS, cps[0])) throw new DisallowedLabelError(`leading combining mark`, cps);
		// [Validity] 6.) For Nontransitional Processing, each value must be either valid or deviation.
		// => satisfied by nfc_idna()
		// [Validity] 7.) If CheckJoiners, the label must satisify the ContextJ rules
		// => satisfied by nfc_idna()
		// [Validity] 8.) see below
	}
	if (check_bidi) {
		// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
		// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
		// * The spec is ambiguious regarding when you can determine a domain name is bidi
		// * According to IDNATestV2, this is calculated AFTER puny decoding
		// https://unicode.org/reports/tr46/#Notation
		// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN
		if (labels.some(cps => cps.some(cp => lookup_member(BIDI_R_AL, cp) || lookup_member(BIDI_AN, cp)))) {
			for (let cps of labels) {
				if (cps.length == 0) continue;
				// https://www.rfc-editor.org/rfc/rfc5893.txt
				// 1.) The first character must be a character with Bidi property L, R, 
				// or AL.  If it has the R or AL property, it is an RTL label; if it
				// has the L property, it is an LTR label.
				if (lookup_member(BIDI_R_AL, cps[0])) { // RTL 
					// 2.) In an RTL label, only characters with the Bidi properties R, AL,
					// AN, EN, ES, CS, ET, ON, BN, or NSM are allowed.
					if (!cps.every(cp => lookup_member(BIDI_R_AL, cp) 
						|| lookup_member(BIDI_AN, cp)
						|| lookup_member(BIDI_EN, cp)
						|| lookup_member(BIDI_ECTOB, cp) 
						|| lookup_member(BIDI_NSM, cp))) throw new DisallowedLabelError(`bidi RTL: disallowed properties`, cps);
					// 3. In an RTL label, the end of the label must be a character with
					// Bidi property R, AL, EN, or AN, followed by zero or more
					// characters with Bidi property NSM.
					let last = cps.length - 1;
					while (lookup_member(BIDI_NSM, cps[last])) last--;
					last = cps[last];
					if (!(lookup_member(BIDI_R_AL, last) 
						|| lookup_member(BIDI_EN, last) 
						|| lookup_member(BIDI_AN, last))) throw new DisallowedLabelError(`bidi RTL: disallowed ending`, cps);
					// 4. In an RTL label, if an EN is present, no AN may be present, and vice versa.
					let en = cps.some(cp => lookup_member(BIDI_EN, cp));
					let an = cps.some(cp => lookup_member(BIDI_AN, cp));
					if (en && an) throw new DisallowedLabelError(`bidi RTL: AN+EN`, cps);
				} else if (lookup_member(BIDI_L, cps[0])) { // LTR
					// 5. In an LTR label, only characters with the Bidi properties L, EN,
					// ES, CS, ET, ON, BN, or NSM are allowed.
					if (!cps.every(cp => lookup_member(BIDI_L, cp) 
						|| lookup_member(BIDI_EN, cp)
						|| lookup_member(BIDI_ECTOB, cp)
						|| lookup_member(BIDI_NSM, cp))) throw new DisallowedLabelError(`bidi LTR: disallowed properties`, cps);
					// 6. end with L or EN .. 0+ NSM
					let last = cps.length - 1;
					while (lookup_member(BIDI_NSM, cps[last])) last--;
					last = cps[last];
					if (!lookup_member(BIDI_L, last) 
						&& !lookup_member(BIDI_EN, last)) throw new DisallowedLabelError(`bidi LTR: disallowed ending`, cps);
				} else {
					throw new DisallowedLabelError(`bidi without direction`, cps);
				}
			}
		}
	}	
	return labels.map(cps => String.fromCodePoint(...cps)).join(String.fromCodePoint(STOP));
}