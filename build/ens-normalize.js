import {lookup_member_span, lookup_mapped, lookup_linear, decode_emoji} from './decoder.js';
import {TableReader} from './decoder.js'; // manually import this
import {escape_unicode} from './utils.js';

//IGNORE
// kludge to make the file runnable as-is
import {readFileSync} from 'fs';
let compressed = JSON.parse(readFileSync(new URL('tables-json/compressed.json', import.meta.url).pathname));
function decompress(key) {
	return compressed[key];
}
function decompress_mapped() {
	let mapped = [];
	for (let i = 1; i <= compressed.max_width; i++) {
		mapped.push(decompress(`M${i}`));
	}
	return mapped;
}
//~IGNORE

// compressed lookup tables
const TABLE_I = decompress('I');
const TABLE_D = decompress('D');
const TABLE_L1 = decompress('L1');
const TABLE_L2 = decompress('L2');
const TABLE_M = decompress_mapped(); 
const TABLE_CM = decompress('CM');
const TABLE_V = decompress('V');
const TABLE_LD = decompress('LD');
const TABLE_RD = decompress('RD');
const TABLE_T = decompress('T');
const ZWNJ_EMOJI = decode_emoji(decompress('E'));

export const DEBUG = {TABLE_I, TABLE_D, TABLE_L1, TABLE_L2, TABLE_M, TABLE_CM, TABLE_V, TABLE_LD, TABLE_RD, TABLE_T, ZWNJ_EMOJI};

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

// adapted from https://github.com/mathiasbynens/punycode.js
// overflow removed because only used after idna
// note: not safe to export for general use
// string -> string
function puny_decode(input) {
	let output = [];
	
	let index = input.lastIndexOf('-');
	for (let i = 0; i < index; ++i) {
		let code = input.charCodeAt(i);
		if (code >= 0x80) throw new Error('punycode: expected basic');
		output.push(code);
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
			if (index >= length) throw new Error('punycode: invalid');
			let code = input.charCodeAt(index++)
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
	return String.fromCodePoint(...output);
}

// warning: these should not be used directly
// expects code-point (number)
// is_* returns boolean
// get_* returns list of code-points or undefined
function is_virama(cp) {
	return !!lookup_mapped(TABLE_V, 0, cp);
}
export function is_disallowed(cp) {
	return lookup_member_span(TABLE_D, cp);
}
export function is_ignored(cp) {
	return lookup_member_span(TABLE_I, cp);
}
export function is_combining_mark(cp) {
    return lookup_member_span(TABLE_CM, cp);
}
export function get_mapped(cp) {
	let mapped = lookup_linear(TABLE_L1, 1, cp);
	if (mapped) return mapped;
	mapped = lookup_linear(TABLE_L2, 2, cp);
	if (mapped) return mapped;
	for (let i = 0; i < TABLE_M.length; i++) {	
		mapped = lookup_mapped(TABLE_M[i], i + 1, cp);
		if (mapped) return mapped;
	}
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

// expects a string 
// throws TypeError if not a string
// returns a string normalized according to IDNA 2008, according to UTS-46 (v14.0.0), +CONTEXTJ, +ZWJ EMOJI
export function idna(s, ignore_disallowed = false) {
	if (typeof s !== 'string') throw new TypeError('expected string');
	let v =  [...s].map(x => x.codePointAt(0)); // convert to code-points
	const empty = [];
	return String.fromCodePoint(...v.map((cp, i) => {
		if (is_disallowed(cp)) {
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp, i);
		}
		if (is_ignored(cp)) return empty;
		if (cp === 0x200C) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && is_virama(v[i - 1])) { 
				return cp; // allowed
			}
			// rule 2: {L,D} + T* + cp + T* + {R,D}
			// L,D,T,R = Joining_Type
			if (i > 0 && i < v.length - 1) { // there is room on either side
				let head = i - 1;
				while (head > 0 && lookup_member_span(TABLE_T, v[head])) head--; // T*
				if (lookup_member_span(TABLE_LD, v[head])) { // L or D
					let tail = i + 1;
					while (tail < v.length - 1 && lookup_member_span(TABLE_T, v[tail])) tail++; // T*
					if (lookup_member_span(TABLE_RD, v[tail])) { // R or D
						return cp; // allowed
					}
				}
			}
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp, i, `ZWJ outside of context`);
		} else if (cp === 0x200D) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && is_virama(v[i - 1])) { 
				return cp; // allowed
			}
			// custom rule: emoji
			if (is_zwnj_emoji(v, i)) {
				return cp; // allowed
			}
			if (ignore_disallowed) return empty; 
			throw new DisallowedCharacterError(cp, i, `ZWNJ outside of context`);
		}
		return get_mapped(cp) ?? cp;
	}).flat()).normalize('NFC');
}

// Primary API
// throws TypeError if not a string
// throws DisallowedLabelError/DisallowedCharacterError if not normalizable
// returns a string ready for namehash
export function ens_normalize(name, ignore_disallowed = false) { // https://unicode.org/reports/tr46/#Processing
	// Processing Rule #1 (Map) via idna()
	// Processing Rule #2 (Normalize) via idna()
	// Processing Rule #3 (Break)
	return idna(name, ignore_disallowed).split('.').map(label => { 
		// Processing Rule #4 (Convert)
		if (label.startsWith('xn--')) {			
			let s = puny_decode(label.slice(4));
			if (s != idna(s, true)) throw new DisallowedLabelError(`puny not idna`, label);
			label = s;
		}
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
		if (label.length > 0 && is_combining_mark(label.codePointAt(0))) throw new DisallowedLabelError(`leading combining mark`, label);
		// Rule #6 (Valid) via idna()
		// Rule #7 (ContextJ) via idna()
		// Rule #8 (Bidi) NYI
		return label;
	}).join('.');
}