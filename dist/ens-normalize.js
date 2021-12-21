function escape_unicode(s) {
	return s.replace(/[^\.\-a-z0-9]/igu, x => `{${x.codePointAt(0).toString(16).toUpperCase()}}`);
}

function label_error(cps, message) {
	return new Error(`Disallowed label "${escape_unicode(String.fromCodePoint(...cps))}": ${message}`);
}

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

// split an array on specific values
// [a, b, x, c, d] => [[a, b], [c, d]]
function split_on(v, x) {
	let ret = [];
	let pos = 0;
	while (true) {
		let next = v.indexOf(x, pos);
		if (next == -1) break;
		ret.push(v.slice(pos, next));
		pos = next + 1;		
	}
	ret.push(v.slice(pos));
	return ret;
}

function decode_arithmetic(bytes) {
	let pos = 0;
	function u16() { return (bytes[pos++] << 8) | bytes[pos++]; }
	
	// decode the frequency table
	let symbol_count = u16();
	let total = 1;
	let acc = [0, 1]; // first symbol has frequency 1
	for (let i = 1; i < symbol_count; i++) {
		acc.push(total += u16());
	}

	// skip the sized-payload that the last 3 symbols index into
	let skip = u16();
	let pos_payload = pos;
	pos += skip;

	let read_width = 0;
	let read_buffer = 0; 
	function read_bit() {
		if (read_width == 0) {
			// this will read beyond end of buffer
			// but (undefined|0) => zero pad
			read_buffer = (read_buffer << 8) | bytes[pos++];
			read_width = 8;
		}
		return (read_buffer >> --read_width) & 1;
	}

	const N = 31;
	const FULL = 2**N;
	const HALF = FULL >>> 1;
	const QRTR = HALF >> 1;
	const MASK = FULL - 1;

	// fill register
	let register = 0;
	for (let i = 0; i < N; i++) register = (register << 1) | read_bit();

	let symbols = [];
	let low = 0;
	let range = FULL; // treat like a float
	while (true) {
		let value = Math.floor((((register - low + 1) * total) - 1) / range);
		let start = 0;
		let end = symbol_count;
		while (end - start > 1) { // binary search
			let mid = (start + end) >>> 1;
			if (value < acc[mid]) {
				end = mid;
			} else {
				start = mid;
			}
		}
		if (start == 0) break; // first symbol is end mark
		symbols.push(start);
		let a = low + Math.floor(range * acc[start]   / total);
		let b = low + Math.floor(range * acc[start+1] / total) - 1;
		while (((a ^ b) & HALF) == 0) {
			register = (register << 1) & MASK | read_bit();
			a = (a << 1) & MASK;
			b = (b << 1) & MASK | 1;
		}
		while (a & ~b & QRTR) {
			register = (register & HALF) | ((register << 1) & (MASK >>> 1)) | read_bit();
			a = (a << 1) ^ HALF;
			b = ((b ^ HALF) << 1) | HALF | 1;
		}
		low = a;
		range = 1 + b - a;
	}
	let offset = symbol_count - 4;
	return symbols.map(x => { // index into payload
		switch (x - offset) {
			case 3: return offset + 0x10100 + ((bytes[pos_payload++] << 16) | (bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 2: return offset + 0x100 + ((bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 1: return offset + bytes[pos_payload++];
			default: return x - 1;
		}
	});
}	

// returns an iterator which returns the next symbol
function decode_payload(s) {
	let values = decode_arithmetic(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
	let pos = 0;
	return () => values[pos++];
}

// eg. [0,1,2,3...] => [0,-1,1,-2,...]
function signed(i) { 
	return (i & 1) ? (~i >> 1) : (i >> 1);
}

function read_counts(n, next) {
	let v = Array(n);
	for (let i = 0; i < n; i++) v[i] = 1 + next();
	return v;
}

function read_ascending(n, next) {
	let v = Array(n);
	for (let i = 0, x = -1; i < n; i++) v[i] = x += 1 + next();
	return v;
}

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// returns [[x, n], ...] s.t. [x,3] == [x,x+1,x+2]
function read_member_table(next) {
	let v1 = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	return [
		...v1.map(x => [x, 1]),
		...vX.map((x, i) => [x, vN[i]])
	].sort((a, b) => a[0] - b[0]);
}

// returns array of 
// [x, ys] => single replacement rule
// [x, ys, n, dx, dx] => linear map
function read_mapped_table(next) {
	let ret = [];
	while (true) {
		let w = next();
		if (w == 0) break;
		ret.push(read_linear_table(w, next));
	}
	while (true) {
		let w = next() - 1;
		if (w < 0) break;
		ret.push(read_replacement_table(w, next));
	}
	return ret.flat().sort((a, b) => a[0] - b[0]);
}

function read_ys_transposed(n, w, next) {
	let m = [read_deltas(n, next)];
	for (let j = 1; j < w; j++) {
		let v = Array(n);
		let prev = m[j - 1];
		for (let i = 0; i < n; i++) {
			v[i] = prev[i] + signed(next());
		}
		m.push(v);
	}
	return m;
}

function read_replacement_table(w, next) { 
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i])])
}

function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i]), vN[i], dx, dy]);
}

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

var PAYLOAD$4 = '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';

let r$4 = decode_payload(PAYLOAD$4);
const COMBINING_RANK = Array(1 + r$4()).fill().map(() => read_member_table(r$4));
const DECOMP = read_mapped_table(r$4);
const COMP_EXCLUSIONS = read_member_table(r$4);

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

// https://datatracker.ietf.org/doc/html/rfc3492
// adapted from https://github.com/mathiasbynens/punycode.js
// puny format: "xn--{ascii}-{0-9a-z}"
// this function receives normalized cps such that:
// * no uppercase 
// * no overflow (#section-6.4)

function puny_decode(cps) {
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

var PAYLOAD$3 = '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';

let r$3 = decode_payload(PAYLOAD$3);
const COMBINING_MARKS = read_member_table(r$3);
const IGNORED = read_member_table(r$3);
const DISALLOWED = read_member_table(r$3);
const MAPPED = read_mapped_table(r$3);

function is_disallowed(cp) {
	return lookup_member(DISALLOWED, cp);
}
function is_ignored(cp) {
	return lookup_member(IGNORED, cp);
}
function is_combining_mark(cp) {
	return lookup_member(COMBINING_MARKS, cp);
}

function tokenized_idna(cps, validate = false, emoji_parser = false) {
	let tokens = [];
	let stack = [];
	function drain() { 
		if (stack.length) {
			tokens.push({t: stack}); // these are textual tokens
			stack = [];
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
			stack.push(cp);
		} else if (cp == 0x2E) { // stop
			drain();
			tokens.push(0);
		} else {
			// mapped: Replace the code point in the string by the value for the mapping in Section 5, IDNA Mapping Table.
			// deviation: Leave the code point unchanged in the string.
			// valid: Leave the code point unchanged in the string.
			stack.push(...(lookup_mapped(MAPPED, cp) ?? [cp]));
		}
	}
	drain();
	return tokens;
}

var PAYLOAD$2 = 'ABIAAQB6AEAAOAAoACYAHwAiABgAFgAOAAsACwAMAY8AfgADApRonwQDRkWQ3QAuAiUsAiIvBhU4AiUsJi8kKTYseCU6THF1fq0BBhoII4t62iwOppXxAggMZXl0EsSlI08hJQIm4E4iAtIB79QGUASzYEOiTVaSUvcJTQB0XwF4jlgA6ew/UKmGaYIABxsLHETXAfIAdP8hPSx8N2c2HCEwIwpPAQJQEhAxFgIxDAk4Bc1bBw8sEmFTBF4FQUoAhQwEBQHJAqYREREzAzNrjAPPMi5BJyYGEy4uiwe5AT8NJ1cLEOIBO2B0xxtDACaQDTcSKidebh9SBREAygJuBXwdngEwAHiMLacsJTgYRCcEV54OLBy5YuEOSGJe+fOKGCMHIgCJSwltQgBUFC41sTEDUEv/EVEhASgDFokGryxRBFAE+wCtBNVlCxXN0WEeBgwJERUQMRIRAwEBAAcfCAEoIwACUeEMBRKVIhs4xw8OcpTxFKQAhAF+IwUcFhMYABsJEgJBaAkYCAAOV1iOqmFxBIwUAEQBIQ4QLdgnARcAEgBKEyQTAjUFEqYbAgBBFw5ylPEODgO9FgUUEB5qCSxuZxMKCA5jWI6qYXEEhhoASQEgEhAz2CgPUA8kEgoEDEoTIwMUBgM1IQg/cXFxcXFxcXFuYXG7BqGPAX/VESx5eBeJgF4AJ+hdQwT4GwAr+GamVOZx7nFoZv8AmEUEQwCXAEkMLQHvBcwDhzn0Mgb7AvgCcRkkAIsAuokwVSwLAmIGPhgnKACLCRkAEicBAQbgO8+xBTABBxcQJgAEQDf6MASDMBD0HwwoDAsu9wDA6hMtcgxWABIITU3k0SHxGPGp8QBhA+dvYj7xAEEFTY2l8Q8x0RWBKEEG8QtKx0dLASBJGLFQ8QBfWx4AFKXRDyrPFXMcIgEPEjzPFaX2Ao9mHqWFELTTP3p6A6f7Xr5EE2R6Ej3HtIV0adYJhLJ9+stTShtJ4R8UgNAPWt0U+he/ohDJ+AuBs5WPUriHRqVyUMryLbfH9cVl9Vb37ztdowEx0WUt+gLVTQGvMkUqORUp6sP7e55HtUVFs4KDB7A06gkRg/ik+DQt6MqdEffNyVDlbXKlCQYPdZuu35KzmouZEE+uvwR58pbLmOw0kws7Wx+VDS+5p7vG8dRotOFjKDKyy2cbI3i64lt3U6/wo0TIibvJOUBVdSbSjLFlTWX2u/KW7j+HF3x6/UuhFOxbEjbdHSkxAycg/YlPDCbyMQLfHigCMdeWtJD2NWpUfk6BralKEmM3KR0Wr4s0GWoCBxSytxpuJ+l984mZrIwoTRq6ahu7znDRTb+hLRnDqqcI4moRTAOhyWD4YzWKYeRntJBZ4aVfoVNeWuBzy+9oyzvROZ89IGTr/3anZuGn+2G+jzjacEahH3JPOhT8k+LFPClF+c5gMeKg';

let r$2 = decode_payload(PAYLOAD$2);
const JOIN_T = read_member_table(r$2);
const JOIN_LD = read_member_table(r$2);
const JOIN_RD = read_member_table(r$2);
const VIRAMA = read_member_table(r$2);
const SCRIPT_GREEK = read_member_table(r$2);
const SCRIPT_HEBREW = read_member_table(r$2);
const SCRIPT_HKH = read_member_table(r$2);

function validate_context(chunks) {
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

var PAYLOAD$1 = 'AA4ABAAtAB4ADAAQAAoADQAJAAUADAB5ABMABwC0HzICAPDcDxkmMZ8hb5wA3EMLFggTAxYhET8EBAKGA9ACAL68wLQC7g0JGuv1RCCKCgBmxAQAp0YJAwEFDA4JAgsGIBUFJwCUAMYLAMVKAwgAZBlnSv0/FAwABAIGBAATe0AD4gAhJQAAHgUVBQUFBQABF2VI/DQNSzsBJK4SAADy8QglE9EAy4E3qggOxQsACBIBATUMRjkMJgAAy61tFRDkFqVeAVkNAW4K5yIACAIM/xZUQgZ60kb6WrHJlmwIO2atRURkH8Ggj9WqsmIy5fmW9MtPnAQ+gT/7Ebxsyyyvq1NcmUOZT7x8XDUemUsJ/kcsHFajOKTLluojPZtNysvpTef0+qKEjsKk6u+STKAoG+A8IGTdK/etoidmmtJLH/Umag==';

let r$1 = decode_payload(PAYLOAD$1);
const DISALLOWED_IDNA2003 = read_member_table(r$1);
const REGIONAL = read_member_table(r$1);
const KEYCAP = read_member_table(r$1);
const EMOJI = read_member_table(r$1);
const MODIFIER = read_member_table(r$1);
const MODIFIER_BASE = read_member_table(r$1);
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
function consume_emoji_sequence(cps, pos) {
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

var PAYLOAD = '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';

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

function is_bidi_label(cps) {
	return cps.some(cp => lookup_member(BIDI_R_AL, cp) || lookup_member(BIDI_AN, cp));
}

function validate_bidi(cps) {
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

// built: 2021-12-21T12:42:17.461Z
const UNICODE = '14.0.0';
const VERSION = '1.3.1';

function flatten_tokens(tokens) {
	return tokens.flatMap(token => token.e ?? nfc(token.t));
}

// Primary API
// throws TypeError if not a string
// throws Error if not normalizable
// returns a string ready for namehash
function ens_normalize(name) { 
	// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
	// "UTS46 with the options transitional=false and useSTD3AsciiRules=true."
	// see: build-tables.js
	// assumptions:
	// * CheckHyphens = true
	// * CheckJoiners = true
	// * CheckBidi = unknown
	// https://unicode.org/reports/tr46/#Processing
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// [Processing] 1.) Map
	// [Processing] 2.) Normalize: Normalize the domain_name string to Unicode Normalization Form C.
	// [Processing] 3.) Break: Break the string into labels at U+002E ( . ) FULL STOP.
	const HYPHEN = 0x2D; // HYPHEN MINUS	
	// note: idna will throw
	let labels = split_on(tokenized_idna(explode_cp(name), false, consume_emoji_sequence), 0).map(tokens => {
		let cps = flatten_tokens(tokens);
		// [Processing] 4.) Convert/Validate
		if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) { // "**--"
			if (cps[0] == 0x78 && cps[1] == 0x6E) { // "xn--"
				let cps_decoded;
				try {
					// Attempt to convert the rest of the label to Unicode according to Punycode [RFC3492].
					// If that conversion fails, record that there was an error, and continue with the next label.
					cps_decoded = puny_decode(cps.slice(4));
					// With either Transitional or Nontransitional Processing, sources already in Punycode are validated without mapping. 
					// In particular, Punycode containing Deviation characters, such as href="xn--fu-hia.de" (for fuß.de) is not remapped. 
					// This provides a mechanism allowing explicit use of Deviation characters even during a transition period. 
					tokens = tokenized_idna(cps_decoded, true, consume_emoji_sequence);
					let expected = flatten_tokens(tokens);
					if (cps_decoded.length != expected.length || !cps_decoded.every((x, i) => x == expected[i])) throw new Error('not normalized');
				} catch (err) {
					throw label_error(cps, `punycode: ${err.message}`);
				}
				// Otherwise replace the original label in the string by the results of the conversion. 
				cps = cps_decoded;
				// warning: this could be empty
				// warning: this could be **--
			}
		}
		if (cps.length > 0) {
			// [Validity] 1.) The label must be in Unicode Normalization Form NFC.
			// => satsified by nfc()
			// [Validity] 2.) If CheckHyphens, the label must not contain a U+002D HYPHEN-MINUS character in both the third and fourth positions.
			// note: we check this here (rather than above) because puny can expand into "aa--bb"
			if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) throw label_error(cps, `invalid label extension`);
			// [Validity] 3.) If CheckHyphens, the label must neither begin nor end with a U+002D HYPHEN-MINUS character.
			if (cps[0] == HYPHEN) throw label_error(cps, `leading hyphen`);
			if (cps[cps.length - 1] == HYPHEN) throw label_error(cps, `trailing hyphen`);		
			// [Validity] 4.) The label must not contain a U+002E ( . ) FULL STOP.
			// => satisfied by [Processing] 3.) Break
			// [Validity] 5.) The label must not begin with a combining mark, that is: General_Category=Mark.
			if (is_combining_mark(cps[0])) throw label_error(cps, `leading combining mark`);
			// [Validity] 6.) For Nontransitional Processing, each value must be either valid or deviation.
			// => satisfied by transform()
			// [Validity] 7.) If CheckJoiners, the label must satisify the ContextJ rules
			// this also does ContextO
			try {
				validate_context(tokens.map(({t}) => t).filter(x => x));
			} catch (err) {
				throw label_error(cps, err.message);
			}
			// [Validity] 8.) see below
		}
		return tokens;
	});
	// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
	// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
	
	// * The spec is ambiguious regarding when you can determine a domain name is bidi
	// * According to IDNATestV2, this is calculated AFTER puny decoding
	// https://unicode.org/reports/tr46/#Notation
	// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN
	let text_labels = labels.map(tokens => tokens.flatMap(({t}) => t ?? []));
	if (text_labels.some(is_bidi_label)) {
		for (let i = 0; i < labels.length; i++) {
			try {
				validate_bidi(text_labels[i]);
			} catch (err) {
				throw label_error(flatten_tokens(labels[i]), `bidi: ${err.message}`);
			}
		}
	}
	
	return labels.map(tokens => String.fromCodePoint(...flatten_tokens(tokens))).join('.');
}

export { UNICODE, VERSION, ens_normalize };
