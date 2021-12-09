import {Decoder} from './decoder.js'; // manually import
import {escape_unicode} from './utils.js';

//#if NODEJS
// kludge to make the file runnable as-is
import {readFileSync, writeFileSync} from 'fs';
function compressed() {
	//return readFileSync(new URL('tables-json/compressed.bin', import.meta.url).pathname);
	return readFileSync(new URL('tables-json/huffman.bin', import.meta.url).pathname);
}
//#end

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

//#if NFC
const COMBINING_RANK = r.read_member_tables(1 + r.read());
const VIRAMA = COMBINING_RANK[r.read()];
const DECOMP = r.read_mapped_table();
const COMP_EXC = r.read_member_table();
//#else
//const VIRAMA = r.read_member_table();
//#end

//#if BIDI
const BIDI_R_AL  = r.read_member_table();
const BIDI_L     = r.read_member_table();
const BIDI_AN    = r.read_member_table();
const BIDI_EN    = r.read_member_table();
const BIDI_ECTOB = r.read_member_table();
const BIDI_NSM   = r.read_member_table();
//#endif

function lookup_member(table, cp) {
	for (let [x, n] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (d < n) return true;
	}
	return false;
}

function lookup_mapped(table, cp) {
	for (let [x, ys, n, dx, dy] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (n > 0) {
			if (d < dx * n && d % dx == 0) {
				let r = d / dx;
				return ys.map(y => y + r * dy);
			} 
		} else if (d == 0) {
			return ys;
		}
	}
}


/*
function nfc(cps) {
	return String.fromCharCode(...cps).normalize('NFC');
}
*/
//#if NFC
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
				if (lookup_member(COMP_EXC, combined)) break;
				return combined;
			}
		}
	}
	return -1;
}

export function nfc(cps) {
	let ret = [];
	let decompose_stack = [];
	let prev_cp = -1;
	let prev_rank = 0;
	let compose_stack = [];
	cps.forEach(cp => decompose(cp, next_decompose));
	pop_decompose();
	if (prev_cp >= 0) ret.push(prev_cp);
	ret.push(...compose_stack);	
	return ret;
	function pop_decompose() {
		decompose_stack.sort((a, b) => a[0] - b[0]).forEach(([r, c]) => next_compose(r, c));
		decompose_stack.length = 0;
	}
	function next_decompose(cp) {
		let rank = 1 + COMBINING_RANK.findIndex(table => lookup_member(table, cp));
		if (rank == 0) {
			pop_decompose();
			next_compose(rank, cp);
		} else {
			decompose_stack.push([rank, cp]);
		}
	}
	function next_compose(rank, cp) {
		if (prev_cp === -1) {
			if (rank == 0) {
				prev_cp = cp;
			} else {
				ret.push(cp);
			}
		} else if (prev_rank > 0 && prev_rank >= rank) {
			if (rank == 0) {
				ret.push(prev_cp, ...compose_stack);
				compose_stack.length = 0;
				prev_cp = cp;
			} else {
				compose_stack.push(cp);
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
				compose_stack.push(cp);
				prev_rank = rank;
			}
		}
	}
}
//#end

// ************************************************************
// https://datatracker.ietf.org/doc/html/rfc3492
// adapted from https://github.com/mathiasbynens/punycode.js
// overflow removed because only used after idna
function puny_decode(input) {
	let output = [];
	
	let index = input.lastIndexOf(0x2D);
	for (let i = 0; i < index; ++i) {
		let cp = input[i];
		if (cp >= 0x80) throw new Error('punycode: expected ASCII');
		output.push(cp);
	}
	index++; // skip delimiter
	
	// https://datatracker.ietf.org/doc/html/rfc3492#section-3.4
	const BASE = 36; 
	const T_MIN = 1;
	const T_MAX = 26;
	const DELTA_SKEW = 38;
	const DELTA_DAMP = 700;
	const BASE_MIN = BASE - T_MIN;
	const MAX_DELTA = (BASE_MIN * T_MAX) >> 1;

	let bias = 72;
	let n = 0x80;

	let i = 0;
	const {length} = input;
	while (index < length) {
		let prev = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (index >= length) throw new Error(`punycode: invalid`);
			let code = input[index++];
			if (code < 0x3A) { // 30 + 0A
				code -= 0x16;
			} else if (code < 0x5B) { // 41 + 1A
				code -= 0x41;
			} else if (code < 0x7B) { // 61 + 1A
				code -= 0x61;
			} else {
				throw new Error(`punycode: invalid byte ${code}`);
			}
			i += code * w;
			const t = k <= bias ? T_MIN : (k >= bias + T_MAX ? T_MAX : k - bias);
			if (code < t) break;
			w *= BASE - t;
		}
		const out = output.length + 1;
		let delta = i - prev;
		delta = prev == 0 ? (delta / DELTA_DAMP)|0 : delta >> 1;
		delta += (delta / out)|0;
		let k = 0;
		while (delta > MAX_DELTA) {
			delta = (delta / BASE_MIN)|0;
			k += BASE;
		}
		bias = (k + BASE * delta / (delta + DELTA_SKEW))|0;
		n += (i / out)|0;
		i %= out;
		output.splice(i++, 0, n);
	}	
	return output;
}

export function is_zwnj_emoji(v, pos) {
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

// warning: these should not be used directly
// expects code-point (number)
// is_* returns boolean
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
	constructor(message, label) {
		super(`Disallowed label "${escape_unicode(label)}": ${message}`);
		this.label = label;
	}
}

export class DisallowedCharacterError extends Error {
	constructor(cp, i, desc = '') {
		super(`Disallowed character "${escape_unicode(String.fromCodePoint(cp))}" at position ${1+i}` + (desc ? `: ${desc}` : ''));
		this.codePoint = cp;
		this.offset = i;
	}
}

// returns a string normalized according to IDNA 2008, according to UTS-46 (v14.0.0), +CONTEXTJ, +ZWJ EMOJI
function idna(cps, ignore_disallowed = false) {
	const empty = [];
	return nfc(cps.map((cp, i) => {
		if (is_disallowed(cp)) {
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp, i);
		}
		if (is_ignored(cp)) return empty;
		if (cp === 0x200C) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(VIRAMA, cps[i - 1])) { 
				return cp; // allowed
			}
			// rule 2: {L,D} + T* + cp + T* + {R,D}
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
			throw new DisallowedCharacterError(cp, i, `ZWJ outside of context`);
		} else if (cp === 0x200D) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(VIRAMA, cps[i - 1])) { 
				return cp; // allowed
			}
			// custom rule: emoji
			if (is_zwnj_emoji(cps, i)) {
				return cp; // allowed
			}
			if (ignore_disallowed) return empty; 
			throw new DisallowedCharacterError(cp, i, `ZWNJ outside of context`);
		}
		return lookup_mapped(MAPPED, cp) ?? cp;
	}).flat());
}


// Primary API
// throws TypeError if not a string
// throws DisallowedLabelError/DisallowedCharacterError if not normalizable
// returns a string ready for namehash
export function ens_normalize(name, ignore_disallowed = false, check_bidi = true) { // https://unicode.org/reports/tr46/#Processing
	// Processing Rule #1 (Map) via idna()
	// Processing Rule #2 (Normalize) via idna()
	// Processing Rule #3 (Break)
	/*
	let labels = [];
	let pos = 0;
	let rest = idna([...name].map(x => x.codePointAt(0)), ignore_disallowed);
	while (true) {
		let next = rest.indexOf(0x2E, pos);
		if (next == -1) break;
		labels.push(rest.slice(0, next));
		pos = next + 1;		
	}
	labels.push(rest.slice(pos));
	// Processing Rule #4 (Convert/Validate)
	let bidi_domain = false;
	for (let label of labels) {
		if (label.length >= 4 && label[0] == 0x2D && label[1] == 0x2D && label[2] == 0x78 && label[3] == 0x6E) { // xn--
			let v1 = puny_decode(label.slice(4));
			let v2 = idna(v1, true);
			if (v1.length != v2.length || !v1.every((x, i) => x == v2[i])) throw new DisallowedLabelError(`puny not idna`);
		}
		if (check_bidi && !bidi_domain) {
			bidi_domain = label.some(cp => lookup_member(BIDI_R_AL, cp) || lookup_member(BIDI_AN));
		}
	}
	*/
	
	

	
	let norm = String.fromCodePoint(...idna([...name].map(x => x.codePointAt(0)), ignore_disallowed)).split('.').map(label => {
		if (label.startsWith('xn--')) {			
			// // Processing Rule #4 (Convert)		

			let v1 = puny_decode([...label.slice(4)].map(x => x.codePointAt(0)));
			let v2 = idna(v1, true);
			if (v1.length != v2.length || !v1.every((x, i) => x == v2[i])) throw new DisallowedLabelError(`puny not idna`);
			label = String.fromCharCode(...v1);

			//let s = puny_decode(label.slice(4));
			//	if (s != idna(s, true)) throw new DisallowedLabelError(`puny not idna`, label);
			//label = s;

		}
		return label;
	}).join('.');
	if (check_bidi) {
		// https://unicode.org/reports/tr46/#Notation
		// A Bidi domain name is a domain name containing at least one character with Bidi_Class R, AL, or AN
		check_bidi = [...norm].map(x => x.codePointAt(0)).some(cp => lookup_member(BIDI_R_AL, cp) || lookup_member(BIDI_AN, cp));
	}
	return norm.split('.').map(label => { 
		if (!label) return label;
		// Processing Rule #4 (Validate)
		// Section 4.1 Validity Criteria
		// https://unicode.org/reports/tr46/#Validity_Criteria
		// Rule #1 (NFC) via by idna()		
		// Rule #2
		if (/^.{2}--/u.test(label)) throw new DisallowedLabelError(`double-hyphen at position 3`, label);
		// Rule #3
		if (label.startsWith('-')) throw new DisallowedLabelError(`leading hyphen`, label);
		if (label.endsWith('-')) throw new DisallowedLabelError(`trailing hyphen`, label);		
		// Rule #4 (Stop) via idna()
		// Rule #5
		if (lookup_member(COMBINING_MARKS, label.codePointAt(0))) throw new DisallowedLabelError(`leading combining mark`, label);
		// Rule #6 (Valid) via idna()
		// Rule #7 (ContextJ) via idna()
		// Rule #8 (Bidi)
		if (check_bidi) {
			// https://unicode.org/reports/tr46/#Validity_Criteria
			// if the domain name is a  Bidi domain name, then the label must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
			let cps = [...label].map(x => x.codePointAt(0));	
			// https://www.rfc-editor.org/rfc/rfc5893.txt
			// 1.) The first character must be a character with Bidi property L, R, 
			// or AL.  If it has the R or AL property, it is an RTL label; if it
			// has the L property, it is an LTR label.
			if (lookup_member(BIDI_R_AL, cps[0])) {
				// 2.) In an RTL label, only characters with the Bidi properties R, AL,
				// AN, EN, ES, CS, ET, ON, BN, or NSM are allowed.
				if (!cps.every(cp => lookup_member(BIDI_R_AL, cp) 
					|| lookup_member(BIDI_AN, cp)
					|| lookup_member(BIDI_EN, cp)
					|| lookup_member(BIDI_ECTOB, cp) 
					|| lookup_member(BIDI_NSM, cp))) throw new DisallowedLabelError(`bidi RTL: disallowed properties`, label);
				// 3. In an RTL label, the end of the label must be a character with
				// Bidi property R, AL, EN, or AN, followed by zero or more
				// characters with Bidi property NSM.
				let last = cps.length - 1;
				while (lookup_member(BIDI_NSM, cps[last])) last--;
				last = cps[last];
				if (!(lookup_member(BIDI_R_AL, last) 
				|| lookup_member(BIDI_EN, last) 
				|| lookup_member(BIDI_AN, last))) throw new DisallowedLabelError(`bidi RTL: disallowed ending`, label);
				// 4. In an RTL label, if an EN is present, no AN may be present, and vice versa.
				let en = cps.findIndex(cp => lookup_member(BIDI_EN, cp));
				let an = cps.findIndex(cp => lookup_member(BIDI_AN, cp));
				if (en >= 0 && an >= 0) throw new DisallowedLabelError(`bidi RTL: AN+EN`, label);
			} else if (lookup_member(BIDI_L, cps[0])) {
				// 5. In an LTR label, only characters with the Bidi properties L, EN,
				// ES, CS, ET, ON, BN, or NSM are allowed.
				if (!cps.every(cp => lookup_member(BIDI_L, cp) 
					|| lookup_member(BIDI_EN, cp)
					|| lookup_member(BIDI_ECTOB, cp)
					|| lookup_member(BIDI_NSM, cp))) throw new DisallowedLabelError(`bidi LTR: disallowed properties`, label);
				// 6. end with L or EN .. 0+ NSM
				let last = cps.length - 1;
				while (lookup_member(BIDI_NSM, cps[last])) last--;
				last = cps[last];
				if (!lookup_member(BIDI_L, last) 
				 && !lookup_member(BIDI_EN, last)) throw new DisallowedLabelError(`bidi LTR: disallowed ending`, label);
			} else {
				throw new DisallowedLabelError(`bidi without direction`, label);
			}
		}
		return label;
	}).join('.');
}