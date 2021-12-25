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
	if (w == 0) return [];
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

/*
export function read_zwj_emoji(next) {
	let buckets = [];
	for (let k = next(); k > 0; k--) {
		let n = 1 + next(); // group size
		let w = 1 + next(); // group width w/o ZWJ
		let p = 1 + next(); // bit positions of zwj
		let z = []; // position of zwj
		let m = []; // emoji vectors
		for (let i = 0; i < n; i++) m.push([]);
		for (let i = 0; i < w; i++) {
			if (p & (1 << (i - 1))) {
				w++; // increase width
				z.push(i); // remember position
				m.forEach(v => v.push(0x200D)); // insert zwj
			} else {
				read_deltas(n, next).forEach((x, i) => m[i].push(x));
			}
		}
		for (let b of z) {
			let bucket = buckets[b];
			if (!bucket) buckets[b] = bucket = [];
			bucket.push(...m);
		}
	}
	return buckets;
}

export function read_emoji(next, sep) {
	let ret = {};
	for (let k = next(); k > 0; k--) {
		let n = 1 + next(); // group size
		let w = 1 + next(); // group width w/o sep
		let p = 1 + next(); // bit positions of sep
		let z = []; // position of sep
		let m = []; // emoji vectors
		for (let i = 0; i < n; i++) m.push([]);
		for (let i = 0; i < w; i++) {
			if (p & (1 << (i - 1))) {
				w++; // increase width
				z.push(i); // remember position
				m.forEach(v => v.push(sep)); // insert 
			} else {
				read_deltas(n, next).forEach((x, i) => m[i].push(x));
			}
		}
		for (let v of m) {
			let bucket = ret[v[0]];
			if (!bucket) bucket = ret[v[0]] = [];
			bucket.push(v.slice(1));
		}
	}
	for (let bucket of Object.values(ret)) {
		bucket.sort((a, b) => b.length - a.length);
	}
	return ret;
}
*/

function read_member_function(r) {
	let table = read_member_table(r);
	return cp => lookup_member(table, cp);
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

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

// my suggested inline ascii-safe unicode escape
// this is ES6 \u{X} without the \u
function quote_cp(cp) {
	return `{${hex_cp(cp)}}`;
}

function escape_unicode(s) {
	// printable w/o:
	// 0x22 " (double-quote)
	// 0x7F DEL
	return s.replace(/[^\x20-\x21\x23-\x7E]/gu, x => quote_cp(x.codePointAt(0)));
	//return s.replace(/[^\.\-a-z0-9]/igu, x => quote_cp(x.codePointAt(0)));
}

function explode_cp(s) {
	if (typeof s != 'string') throw new TypeError(`expected string`);	
	return [...s].map(c => c.codePointAt(0));
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

// this returns [[]] if empty
// {e:[],u:[]} => emoji
// {v:[]} => chars
function tokenized_idna(cps, emoji_parser, tokenizer) {
	let chars = [];
	let tokens = [];
	let labels = [tokens];
	function drain() { 
		if (chars.length > 0) {
			tokens.push({v: chars}); 
			chars = [];
		}
	}
	for (let i = 0; i < cps.length; i++) {
		if (emoji_parser) {
			let [len, e] = emoji_parser(cps, i);
			if (len > 0) {
				drain();
				tokens.push({e, u:cps.slice(i, i+len)}); // these are emoji tokens
				i += len - 1;
				continue;
			}
		} 
		let cp = cps[i];
		let token = tokenizer(cp);
		if (Array.isArray(token)) { // this is more characters
			chars.push(...token);
		} else {
			drain();
			if (token) { // this is a token
				tokens.push(token);
			} else { // this is a label separator
				tokens = []; // create a new label
				labels.push(tokens);
			}
		}
	}
	drain();
	return labels;
}

// returns an emoji parser
function emoji_parser_factory(r) {	
	const REGIONAL = read_member_function(r);
	const KEYCAP_OG = read_member_function(r);
	const KEYCAP_FIXED = read_member_function(r);
	const EMOJI_OPT = read_member_function(r);
	const EMOJI_REQ = read_member_function(r);
	const MODIFIER = read_member_function(r);
	const MODIFIER_BASE = read_member_function(r);
	const TAG_SPEC = read_member_function(r);

	const FE0F = 0xFE0F;
	const ZWJ = 0x200D;
	const KEYCAP_END = 0x20E3;
	const TAG_END = 0xE007F;

	function find_emoji_chr_mod_pre(cps, pos) {
		let cp = cps[pos];
		let cp2 = cps[pos+1]; // out of bounds, but unassigned
		// emoji_modifier_sequence := emoji_modifier_base emoji_modifier
		let base = MODIFIER_BASE(cp);
		if (base && cp2 && MODIFIER(cp2)) {
			return [2, [cp, cp2]];
		}
		// emoji_modifier_base is a emoji_character 
		// emoji_presentation_sequence := emoji_character \x{FE0F}
		// but some emoji dont need presentation
		// and previously valid emoji are already registered
		// we call these emoji optional
		let opt = base || EMOJI_OPT(cp); 
		if (cp2 == FE0F) {
			// these have optional FE0F 
			if (opt) return [2, [cp]]; // drop FE0F
			// these require FE0F
			// these are the new emoji 
			// all future emoji should be added 
			// through this mechanism, if appropriate 
			if (EMOJI_REQ(cp)) return [2, [cp, FE0F]]; // keep FE0F
		}
		// emoji_character 
		// we also allow single regional 
		if (base || opt || REGIONAL(cp) || MODIFIER(cp)) {
			return [1, [cp]];	
		}
	}

	return function(cps, pos) {
		let cp = cps[pos];
		let len = cps.length;
		// [ED-14] emoji flag sequence
		// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
		// A sequence of two Regional Indicator characters, where the corresponding ASCII characters are valid region sequences as specified 
		if (pos+1 < len && REGIONAL(cp)) {
			// emoji_flag_sequence := regional_indicator regional_indicator
			let cp2 = cps[pos+1];
			if (REGIONAL(cp2)) {
				return [2, [cp, cp2]];
			}
		} 
		// [ED-14c] emoji keycap sequence
		// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
		// A sequence of the following form: 
		// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
		let keycap_og = KEYCAP_OG(cp);
		if (pos+1 < len && keycap_og && cps[pos+1] == KEYCAP_END) {
			return [2, [cp, KEYCAP_END]];
		} else if (pos+2 < len && (keycap_og || KEYCAP_FIXED(cp)) && cps[pos+1] == FE0F && cps[pos+2] == KEYCAP_END) {
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
			if (pos2+2 < len && TAG_SPEC(cps[pos2])) {
				let pos3 = pos2 + 1;
				while (pos3+1 < len && TAG_SPEC(cps[pos3])) pos3++;
				if (cps[pos3++] == TAG_END) {
					// these are crazy dangerous because they don't render
					// ignore the sequence
					// return [pos3 - pos, stack.concat(cps.slice(pos2, pos3 - pos2))];
					return [pos3 - pos, stack];
				}
			}
		}
		return [pos2 - pos, stack];	};
}

var PAYLOAD$3 = 'ABIAAQB6AEAAOAAoACYAHwAiABgAFgAOAAsACwAMAY8AfgADApQhCD9xcXFxcXFxcW5hcbsGoY8Bf9URLHl4F4mAXgAn6F1DBPgbACv4ZqZU5nHucWhm/wCYRQRDAJcASQwtAe8FzAOHOfQyBvsC+GifBANGRZDdAC4CJSwCIi8GFTgCJSwmLyQpNix4JTpMcXV+rQEGGggji3raLA6mlfECCAxleXQSxKUjTyElAibgTiIC0gHv1AZQBLNgQ6JNVpJS9wlNAHRfAXiOWADp7D9QqYZpggAHGwscRNcB8gB0/yE9LHw3ZzYcITAjCk8BAlASEDEWAjEMCTgFzVsHDywSYVMEXgVBSgCFDAQFAckCphERETMDM2uMA88yLkEnJgYTLi6LB7kBPw0nVwsQ4gE7YHTHG0MAJpANNxIqJ15uH1IFEQDKAm4FfB2eATAAeIwtpywlOBhEJwRXng4sHLli4Q5IYl7584oYIwciAIlLCW1CAFQULjWxMQNQS/8RUSEBKAMWiQavLFEEUAT7AK0E1WULFc3RYR4GDAkRFRAxEhEDAQEABx8IASgjAAJR4QwFEpUiGzjHDw5ylPEUpACEAX4jBRwWExgAGwkSAkFoCRgIAA5XWI6qYXEEjBQARAEhDhAt2CcBFwASAEoTJBMCNQUSphsCAEEXDnKU8Q4OA70WBRQQHmoJLG5nEwoIDmNYjqphcQSGGgBJASASEDPYKA9QDyQSCgQMShMjAxQGAzUCcRkkAIsAuokwVSwLAmIGPhgnKACLCRkAEicBAQbgO8+xBTABBxcQJgAEQDf6MASDMBD0HwwoDAsu9wDA6hMtcgxWABIITU3k0SHxGPGp8QBhA+dvYj7xAEEFTY2l8Q8x0RWBKEEG8QtKx0dLASBJGLFQ8QBfWx4AFKXRDyrPFXMcIgEPEjzcS9Wn/KALJxnXU2YJOBWKOmP82gdIgmNcRsDi+p7FBLYbwm9Uzs1RfCbNpY30PNDOtZBhbqPBybOPeWa7oi+ySNuja7E79Fz+oJqkWRGdXLqRl46pfoUDu0uKXTiGuFf3GtJzAXtJmxI3V8am/mpQnjfi99U7ZkojTh6fKYexodlCUm8Nn5tkJXqdPwxaQiU29Pa8nQxhFccS0ZzA2p+XNo3r68FBGjQNasxwtQH/0ELiOQLNuyc0YqOxCPnfFsvASXVP7enrn5p48UHDGS6NU/kYR37WSJ7+CN+nV4NqWlRTc/nQOuWoDD2Cnkn26E21fE+79xMXG2voqdtyef5eUY6MOoAAPIvdUDW+i16JSxe2+srXAYVvzbE8SKhyxzjFf2rMlgMycfXR8nl6/xF97xDwBSNLExVnK4YUGbAMpgGeHD0vHVXsIK20HyDdJQ9a5Uhwta5o+Tw/HpthmalqVX7v90SgUzjZaEahH3JPOhT8k+LFPClF+c5gMeKg';

let r$3 = decode_payload(PAYLOAD$3);
const VIRAMA = read_member_function(r$3);
const JOIN_T = read_member_function(r$3);
const JOIN_LD = read_member_function(r$3);
const JOIN_RD = read_member_function(r$3);
const SCRIPT_GREEK = read_member_function(r$3);
const SCRIPT_HEBREW = read_member_function(r$3);
const SCRIPT_HKH = read_member_function(r$3);

// chunks is a list of textual code-points
// chunks can be empty and contain empty lists
function validate_context(cps) {
	// apply relative checks
	for (let i = 0, e = cps.length - 1; i <= e; i++) {
		switch (cps[i]) {
			case 0x200C: { 
				// ZERO WIDTH NON-JOINER (ZWNJ)
				// ContextJ: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1	
				// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
				if (i > 0 && VIRAMA(cps[i - 1])) continue;
				// If RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D})) Then True;
				if (i > 0 && i < e) { // there is room on either side
					let head = i - 1;
					while (head > 0 && JOIN_T(cps[head])) head--; // T*
					if (JOIN_LD(cps[head])) { // L or D
						let tail = i + 1;
						while (tail < e && JOIN_T(cps[tail])) tail++; // T*
						if (JOIN_RD(cps[tail])) { // R or D
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
				if (i > 0 && VIRAMA(cps[i-1])) continue;
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
				if (i < e && SCRIPT_GREEK(cps[i+1])) continue; 
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
				if (i > 0 && SCRIPT_HEBREW(cps[i-1])) continue;
				break;
			}
			default: continue;
		}
		// the default behavior above is to continue if the context is valid
		// we only fall-through if no context was matched
		throw new Error(`No context for "${escape_unicode(String.fromCodePoint(cps[i]))}"`);
	}
	// apply global checks
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
	// The effect of this rule is to require at least one character in the label to be in one of those scripts.
	// For All Characters: If Script(cp) .in. {Hiragana, Katakana, Han} Then True; End For;
	if (cps.includes(0x30FB) && !cps.some(cp => SCRIPT_HKH(cp))) {
		throw new Error(`Disallowed katakana`);
	}
}

var PAYLOAD$2 = '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';

let r$2 = decode_payload(PAYLOAD$2);
const COMBINING_RANK = Array(1 + r$2()).fill().map(() => read_member_table(r$2));
const DECOMP = read_mapped_table(r$2);
const COMP_EXCLUSIONS = read_member_table(r$2);

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

var PAYLOAD$1 = 'ACUAAQDpAIEAfgBLAFkAawBgADAAVQAmACMAIgAlACAAPQAXABMAFQAOAA0ADAATABIAEgAPABEACwAMAAwAFAAlAA4CiAD2AAMEfQRvDCAA6xbF2ewNxQcEpzEwUhdEIQ4MFPFdAQR+Xghu/sUJhTcAxgAjDIIT11i1UgSFFg5DORgJEggA8l1t/b8GgzAAwgAECncPWK5LBIPsVokBEm8EjVUKOSQHJQoSRAAkpU4lim0AaUYDM38ErACLsk0bwwE9Py5BYQFLAfUFWXmEMgEEQlUcDdxTNj3nMabMOtteTE7wrBKhLiUA8HAuAPZKIwPMS5cW4WkBPiA9AKFuMnGFBgKIGAkPEAICHRQQGRAAWAgAGCY2AV4+HA4+By4BCA4OI0IXAgIaFiELCt72BhR4WAC0AEQCQgLeyQ4dAQs6OQo9Pg4eH4lDGN5VrgAeDh4wDkUlAh4sAgwCAg8NFgAeVCqOBxMZTm4C7AM6BA5lDjQhjj4LAQ4HFn4GBg4dIwAeCQcuIxMRAhsmDoEeGY4WHRkODB6ufj0uEAQMHAAuEm4jBwAeqR0C304J7k4DDg6uIt4BHjAOFQGhni4hKxbeA94hzgAuCW5OEZ6O3gcfAAAQXn40JiAANBIYGBgYGgEVFANZAN4VACAODgPOB/4eVAgODI6l3g8evhVuKC4G3gr+3v7eAJ8xaoQEDxUHDgILBgBXBxchNAFdNxI3ACQGChYOFg4aCZ70BBMHIyzewwQWNDgJPA4LDhCFQRieVWsAGw0uRCASIgQOBxEYUyqCDxlMSDdZCwsPAgQDfAICBhIAFQgUDwIBEg0WERARCQ0xCAYMJwQEAwJ5TaJBAw0BJQEXLw45KRYW1gO0AAEAaklS1AUcGTMlHwAyERcXFxcA3gsKGBsKpb4PF7wVYBwPAPwSKf7c/twFvADjBN8+AQMAA34ADpgelQ9gBRwYYgLm2WYCr9PLGBAJzhANkwEBZU0AcmA8UgHw1AIsBJ8CuREAEAVbADUN4E45AeJxUvNSfwK0AOB9Bl1loWFBA3QYGBgYChoNDlwFIYoDANxjAOdXAMYA2gDfYwGgAzQB6QAzACJ4BL8PPhcAyYhoAKEBMQFUACzlXkPODDwAAzsRChOJRRjAVa4AW09gAAYaAdRQsm8MAndjAC4uCIcD9wTsCFObqROxVN4azu4OThg91H4Cu14+Hg4uAD5yA0j+3v7e/t7+3v7e/t7+3v7e/t7+3v7e/t4A0Pzs/t7+3gIADg4AhG8GAKAAMQFSRzw3tAIeFQABKyA1CkIDArZSNxYGADJxFeAM7kwEnod/ygAbEhkPHAIlEhkTHBEWIxlvEic5XmJrmgYHEHhnxxmTgt4PaXlhsZIQPA4SE81ODwW9wQY9BKBNMI86Q38/5DoAYUwBZXtFAdEsUJZzaW8HCL0B3wBh7A4qGWkkVCMJDh0QPD0eAx4lukgZTkBLLjdyAbYCkyAgWHm8HxsuFBMAGxt4pgHuCv3PAShNdLQIMAATfSQXFEtbDFHyBDQFaQqLAR0AZXkalBkSJQUxFESLGQmmT841T0vm4HcFCA8AdjhaLwBBStseAz1L7BFBDgEVA3YGnBk+BD3oAJoEwlILFppOCwIeDBUQzntD+oaxJbOqEsPmVoztmeEOgU272aOQMCbwOpB/Ypso4k/TTLW0oWpP3Rz3gHw2yY1UgZPtktnZk107pZPg3CQ+O2NJZ4RdQ8VrO8v8sA5Nf64eb7biK378+U434pbsbN5D/nUXJvQoZ2tsF7kCJBqxJCTNIptt2KVrMk9oCmdP0yza2mLjtAXAvD9RwvMgHNASOAHQHieInuWJb1575ohdCFscyN5HjENm6r3fmapvd12TrCubUm7XFYfHvmy8dSIQOESuJavaW0D8rbUXGUc7rPRuiWRnOFLlYcrqLc3LiwzjN7uzF6ECR7SY0Tzdx+FJN5Dl8dSD9VRuo2SKneiXQYjuXJ70nT50AuF9I7taX6vp5rEML9UbCTMpLStDd8XHbeVYsjSuXkuxcXDGzy11XOqM4/Ld+ZRABTvb0FzlY8mXbveszS4/glZhNu5eLJmy5AooQTWVutjvuWDrsDkUZ9am2TOeKMG8TLHRwjVBB4FhPtiujqXvesGvWwQ1w3s89y+jX47rIhp+El9c2QFM4BVQggIR28OeFU3V5TjwdLSSW8/9MAJ+qPuP74Iy+oDcIeIjgCJGHt52YnnwJV5+xKR+HjQws+fTAiOhcOW+zy609VzzQk+y0A7kdHdBBsXBB36UOFdzdYujG5PO1IXoFWrs3trl6gV4JKHvTsSvFdHz22LQv21L1uh45KVqrt+uUQyVd6ulDXkU/TOXxUk+HcujwWsIGjbyNKggFFDe5Mc4eHSKGezjtMlWeigB0nB6+8BrawOjtBF04xeKukf+o037M7ExZxCAGsVZ0PpTtc1TJlHhU+eUkh3LpBhTs2XCQewf98wydOE14KvF948SMOcIGmBFbIJR1V45meM46ACb1xWIaoJ3MkVdmkp7LuDsLQXzO742rKyrd/KspPEmjyviR3dNO/MNxJTes46EMlMdsAMMLPebHcs5hRcRuz1/3OWqWFHqsh7caP90rBA5z+0izaxZSEowxCpGcXJQmNX9ZRy7Wv2wppZZq5X96vy3Rhy6NkxfjqH4/xB5uK7Icux88zxeKS7HmRvYcD8R+lFRBO5I2hpXjDgvpLU+7LiZ7rsriL2IYSB5FoDZgc0aM7b51cp3qP5LO1LVPlSZunn1e/++/NlO4eEbUxhPePIEkeDKLV5SOXSS+SdvvpIbWH7fhP2kZRVCfvWrXrTny8dF2vD0/c17qfSxPu4hBzxzYL0X0HiW3j4APx7arPhNWGGOMWyuGGwuycrdUX3N1O3MCM+qWMORw+vbHSf7dxpmse8hGZvWaY9vtOvMRlFdhveoSnJLhb63k7kZxhLgSnbSVrw4SgaQmAVbn9aMlXJUuAW5/7DeZtB3AXYZJsC8u7TQ3U6MRQH3W0Y+TbKy23n6WDnjFbCNWCdxG69uYaQ65G91unS+/VBV5ogka0CGR7Pv1YajbSPKr+opmKCb8f/fHsNZ6yFhw4UYHSVjedw+2yeZ5IuZ6t35SPLGkb2zQC2XtoVv4vfHXPMH9GXD0mvawBsT2wVm/NdfNcvMGrXSpnK8FBBUUazjP+S4U5ffPk0rTU/FefFYW+Y2Ir95i4j0HghljDTPXjDwRIS9jeeG8RSNJV1X7TJVb/w2cACSCwugUvUcxGm9OQL9SDI=';

let r$1 = decode_payload(PAYLOAD$1);
const BIDI_R_AL = read_member_table(r$1);
const BIDI_L = read_member_table(r$1);
const BIDI_AN = read_member_table(r$1);
const BIDI_EN = read_member_table(r$1);
const BIDI_ECTOB = read_member_table(r$1);
const BIDI_NSM = read_member_table(r$1);

// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
// * The spec is ambiguious regarding when you can determine a domain name is bidi
// * According to IDNATestV2, this is calculated AFTER puny decoding
// https://unicode.org/reports/tr46/#Notation
// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN

function is_bidi_label(cps) {
	return cps.some(cp => lookup_member(BIDI_R_AL, cp) || lookup_member(BIDI_AN, cp));
}

function validate_bidi_label(cps) {
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

var PAYLOAD = 'AEQLAQQ3Ak0BLAFOAIQA/ACTAIIAiwCKAFMAbQBGAFoAZwBpADoARwAkAEAAHQA7ACEALABTAEIAEwAhACMAPgAyAC8AGQAmAB0ANAANABoAEQAdABkAIQAYABgAIwAbADwAJAAgACYAGgAVABUAMAAUABsADAAtAA0AHAALABcAFgP+BW4AzhFEASQ7tAYoAe4AExozi0UAH21tAaMnBT8CrnIyhrMI8gIBUAEHcoFHUPe8AXBjAewCjgDQR8IICIcEcQLwATXCDgzvBYABTRcUAykgDhAMShskMgo8AY8jqAQfAUAfHw8BDw87MioGlCIPBwZgetRqA+EpJVhYLA5fACIXJEoPFwB3b08AXCEBIg0+Dj4VKm8hAgBKAEt+AHo/GG8fNyYE/18PIB8Wf+8PESAsTxwPbwcPj38PDx8ADxb/nwLALwnPLxK/Ir8A/xEPAaJfDhAWvwO/Ia8ADwlPLxEjb78Fnx8DXwFaAx6/mQABA9+GGgHSTwCuzy8EFDlfApw/Hw8AH1MDK6W/Dv+fFU8wDyAaFyMkCTRfIacCFQE/GBgFAAwzW3i7A+AmJFYoPRIVHgNvTAAbGQUzDSYqYzoXNfYHCA0fGwcEBxIIAlougyIC7gEGAPgQBQoWtwOV4gBLKjO1BRYBS4QDIwKXMxgAE1Klnw74nRVBG/ASCm0BYRN/BrsU3VoWy+S0vV8LQx+vxgEwcABOBxngDYYHSjIACw9LLgBr9hUF7z0CereWKnc0TaGPGAEnAtZvfwCsA4kK31RfZH8PyQO/AToJf/r4FzMPYg+CHQAcAXworAAaAE8AagEiG94eHRfeGh/xAngClwKuNDY4AwU8BWEFOgF7N6AAYAA+FzYJlgmXXgpebSBWXlKhoMqDRwAYABEAGgATcFkAJgATAEzzGt09+AA5Xcqa5jMAFihRSFKlCvEiUQgLzvwAXT3xABgAEQAaABNwIGFAnADD8AAgAD4BBJWzaCcIAIEBFMAWwKoAAdq9BWAF5QLQpALEtQAKUSGkahR4GnIViDYywCl/J0cXP29feC7ZChMqeBRhBlJBEwps5YMACKQKCgDCKB4UCAJ9BNKQ0BQuB4c56AAAACACNgsFf1a4lvFqQAAETgBBcQw0BwUGApkyApOOBB/M1okAFbIBTdeXAB86V2CQBUIANpI5BfbPFgPNxgALA5miDgo0Ao6mAobdP5MDNp4Cg/fyRPfTpAACAHiSCiZWAPQAHgQAAgAAAAQAFAYIAwH8EQsUBhBqfSseAgnRAHoKQ2OblR4nAioGNTQ87xMgumRyZ5ICIkxWBjUBH2kWBlTLoUoAHRT4AS+VAARuggV2BdU84NcCgABXYrgAUQBcAF0AbABvAHYAawB2AG8AhABxMH8UAVROUxEAA1RYUwcAQwDSCwKnAs4C0wKUAq0C+rwADAC/ADy4TQSpBOoJRikwFOA6+DdhGBMAQpAASpPKxwG2AZsCKAIlOAI3/wKuAqMAgADSAoc4GjQbArE4Hjg3BV64ApUCnQKkAYkBmAKrArI07DR7HzTwNIsbAFk1ojgDBTw0EjQpNgQ2RzaMNk02VDYZNvCZ6D5/MkISQgdCCEIhAoICoQKwAScANQVeBV20vwVuO2JCGTlXIlKrNOQ0vxcAAVMCVtdXupx7mGZkof0QGAPKDCr2fCgEqFACWFgCeiCwLAGUqKo6YANKHASIZg4A1gAGsEQ0KAAHLgI+YgBwAWYkdgCIIh4AmgFOvAAsbhwBtMoDPDImSAJYAXReBmoCagD2ThwDLgYKAE5GALAAYgB4ADC6Bgz49B6ShAQADiYALgC4IEwB1gHgDBA23dtFHoHtAA8AFgA5AEIAPTh3ftjFEGQQYQYDTQ5McT8VEAKxD6sL6hEaDNYq0NPdADSuB/ADWAfwA1gDWAfwB/ADWAfwA1gDWANYA1gcD/Af2MUQZA9NBHIFkwWQBNsIiCZOEYYHLQjXVBJ0IxxMA0oBASMqSSE7mDMQJUdMEU0ICAE2R2ysfT0DTDGwVPqQpwPQMlQ5cQYDHnYSpQAvD3ghNbpOg3pMcaUKUE+zV/cARQYAEqsAEuYASQ0oAFAsBj0ASOM02AATRgBNmwBNygBMXRgASmgG4ABQVwBQjgBQSQASNklnTmwCwzqtP/0KJgmYb8B3UwZCEBwnphD4DDQBtgE8De5L2QTyBjwEyh9+GRoPzpWdCKYt3gzuJuQuooBbI/YqhAXuS/U83gtOUWkPWgtmCeQ6ZIFPAyIBDiKMCt4NOghuEPQKymwN5hFGBzoD1kmbAKYHAgsSHTYVtiYRYq0LCjl4Bvwa9wuQJrATKnr9BdQaIgZOASobAADQLuiFsVoyXB1PYAYECyYjyBSpUCENJkC4eEkaHAcWJaoCkkNxSohRNx6UIfc8Pg1nLhRRfQf2PAYZUAuCPJ9GrEUPEdM+jj1JIkpMLQQ2gCwwJ4wJ0A+GDLp8cwFaCSIJsgxyEzIRGDfGCDoHGi6XJScWCCJGlmCbBPigA/QT0gMMBUAJQgcUA7YcLhMvFSoFDoEl2AL0NtYutAKQVoEBGAXMDyYf4BBRR+EO6gicAmYDhCXsAC4VIgAYIpwIRGQAYI/ZUwYuzAjIam0jdQNoFOhiEXQHkg5YB6gcNBXAHOJwyV4MhgkopLAJXAF2CZoBYATkCAo1XIyhIEJnVItZGJwgYkFAXf0CMgxmFaBEvod5AowPbBIcATYBdAc6DQICeBHuEWwQlgjshgU1tjP5OiYEUCGEIBIKKANQbM8LKCb6DPlqAaQSYwMNND5372esYLclF/4HGjLGQWEh8guTT84MnRrCGENULxnlB8AD9Br0J+tBWAYAA6QEFDpOM+8EvgtqCIwJQABKDqQYB9gYawpyjNEBMowBuJoDWJKEAnCQBjgHDABoDIgFeuYAHgKoCKQABgDQA1gAOgKuB54AGgCGQgE+AygwASLmApADlAgyzAGWMAH0KgQcxAwWAPg4bksCw7ICgGtmowXeWQKPAko2AU4mBAZPSFIDsHLiANwATAYU4EgBFqxLzBvkRAHgcCwAyAD8AAY2BwZCAc4B9G4AuAFgCzIJo7S2AU7qKgCEABZsAdgCigDeADYAgPIBVABOBVr6BdQCUEoBEjIZLFhiAbwDIAE0AQ4AegbMjqbKCCAEbgfUAhAcFeIC7y8HtgIDIuATzkLGAr3fVgAyFwBgURwemR6cHpk+jV5oALRhNAcycz1RAA8fqT7IB3L8FkiJAiZLAFDmAFBDNJo1MVZJNgGnAaopArfwAW2rAEj/ArfuAretArewArrbzQLSArfcArfPEABQQgBQP1KSUoMCt6QCvDkARADMAcI7XjtHOz47WTteO0c7PjtZO147Rzs+O1k7XjtHOz47WTteO0c7PjtZA5goWCNNwFVNKCapCm1fRmHsDKcN1UTJOkoT3GBSYDMTyS24FMIVzyVXGT4avScGJeVVCg8FLdRmMQgtNHYXvQBAKWmDQmOHHjEKTBzoU5JU+S0cALJLozOwDa0bFkRBBUh17mIrFg8KIwJkggJiQ1xOsFw3IQKh+AJomQJmCgKfhTgcDAJmPAJmJwRvBIADfxQDfpM5Bzl4GDmDOiQkAmwaAjI3OAsCbcgCba/wiwA0aEYsAWgA3wDiAEsGB5kMjgD/DMMADrYCdzACdqNAAnlMRAJ4ux5d3EWvRvQCfEACeskCfQoCfPFIAUh+ZCUALBZJWUpcFhhKzQLRAgLQzUsoA4hQA4fnRMaRMwLyol0EAwOvS89MLiYE0E1NTbACi0ACitnCHAgeRGgGuAKOOAKOXUGYggKO2gKOXXlRtVM2C1LVVIYCk/wCkw0A6gAdVR9VsFXRBywcKZaHMuJ4Z0U8OgKXoALvs1giqQBaJgKWkAKWfZ0AqlmtWgqCTgA8Apa2ApZPXEVc0gKZzAKZZVzLXQgaApycOcM6ngKcFwKfnAKeuYsAHhAyKxACnfICnpMAtj5hNWHwAp7UAqBvAaoCnqAgAp5PpmPJZCgmLAInsAImfwKg/AKgTdgCpjACpc8CqAAAfgKn82h9aLIABEpqHWrSAqzkAqyvAq1oAq0DAlceAlXdArHi2AMfT2yYArK+DgKy5xZs4W1kbUlgAyXOArZdPEBukQMpRgK4XwK5SBYCuSt4cDdw4gK9GgMtswMyEgK+iXIDAzNyAr4bcyNzUALDzALDBXODdEw2RnThAzyoAzybAz3AAsV9AsZIAsYRigLIalICyEUCyVACyS8CZJ4C3dN4emJ4r3kmS9EDGKRnAwJh9Rn0lSV7DF6TXrwSAs9sAs9tMExU0/QUoADHrgLPdAEq6wNOE35MBgLcKALbiwLSUANSXQNTYAECA1WNgIpAAcwX7mFGdgCCz4OOAtrIAtnfhBGESqc9A4amADADZA+Gclr6AFYC32YC3rl0eALiMO0VAfMxKAH0nAHy04gC6/QC6XF6AALq+gLq5QD6SAG6Au6KAuudlquXBALuQAOF4Zh6cOFxogLzBABqA44XmZQC9xQDkW8DkogC95kC+doC+GeaHZqsvDibHwOdhAL++wEcADqfHZ+0AwWOA6ZrA6baANLGAwZroYmiBgoDDEoBYPAAugECrQGfPBO9AZU/JQ2goTEacQD5BSgEgh8AEcXXTfXRnhseMC+SA2ZYA3oARAK+uQRWpMYDAKwFFsAD7iJCQwIdHTvaMjY9NtQ2yTZGNjk28DbdNko2JTcQNxk3kj5FPENFMEImQrlUFgoWFl/BAJbKBTcAkFEem747K2A3FrrUDjQYyxiOyfsFXAVdBVwFXQVoBV0FXAVdBVwFXQVcBV0FXAVdSxoI3IoArgABBQcHApTuggKhbV7uMAP8A1taGGUUDgwKAAwKAKqWjIJ4qiMlCgoDejVNNU81UTVTNVU1VzVZNVs1TTVPNVE1UzVVNVc1WTVbNY01jzWRNZM1lTWXNZk1mzWNNY81kTWTNZU1lzWZNZs2DTYPNhE2EzYVNhc2GTYbNg02DzYRNhM2FTYXNhk2GzYtNrk2NTbZNkU3OVlTPuZOCT1vAgfMbsxszGrMaMxmzGTMYsxgzF4KEEAEFgEp39Lf0N/O38zfyt/I38bfxN/C38AF+iIBIzgMGgV1BWsFaQVfBV01MwVRBUsFSQV8BXjKKMomyiTKIsogyh7KHMoayhgJNQ8NAwcJDQ8TFRcZGwllBggCBABAPg4ABggCBAAOAhICZ2kfvXwNeA96qWMO3zjFwwCEG9ImGB4psSIdvh++PkEpJE9CtkI7PShfLGA7LB8oCcZuApUGggJCC14HXgg+5j7mPuJBQz7mPuY+5j7kPuY+5D7iPuA+5j7ePuY+4j7ePto+6HReUmRCTjJWMFIwMDgVFgkEBgICM0cXQhBB/kIoGRlnaWdpXgFs8DqqO7BVqoAKYz6MRkRSaUY+3z7jPt8+2T7VPuE+4T7dPt0+3T7dPts+2z7XPtc+1z7XPuHMcMxuzGwjVDNMIkUBIxVFAC84DTNHOQUTTjclYhDf0t/Q387fzN/K38jfxt/E38LfwN/S39Dfzt/M38o1MzU1NTMzM0IDQg9CD8oqyijKJsokyiLKIMoeyhzKGsoYyirKKMomyiTKIsogyh7KHMoayhjKKsoo3NxeBGztOqc7rVWngAdjO4xDRE9pQx8XugdUB7PI6z8kPsFKQiobrm0+zj0KSD7mHlJiDmg8RDA6PCYYIzEzHykNEPVCEEIk9j7lFhBhCxVyXjwnCx6pQgNCEwAJJycvRWI4HThFJxU8FgYGUwhBMccXYBBfs0BAMjg8FiMnETkdI0FQNxVaMhc2MAs6IBhCIiUWUhUGSEJCAzHWWGAaXzVAQiInQgMGQQR/aGCrAH4GPwUUJD9aMho/Q0yIBg2LAJUBLQ9KeUKSpR0sTxwFnqIGHgTwEXCK2MYDoWMiAbJQx1RpUAbpqgHAD/LNC0oFNQQWGw0BLA9RAYICdAOOWqYPDwRriAHPCt6wAQkudJUR8hwFNa1Q8wQVBUpsAP4ARlo9Dx1yhDq+EzoxzsNOAGQZRwoAH0q8AuAgS2wRIgD0VwZ9HwQeyQB7BKMzDlQ7yDsQKbt66ZT1FUZ6ZttSbE1IlarIMI+nKn1bCC2LQOrG8wdsCZlS1MzedqS2/h26kVpg1Hfz5cg/DoAkAZBK8V+BhHjRuQyCQ7t4w0rd56+KJT9+wW2QPF/thyOqnpfOX95pyBtMuDGW5cfCBMV8azEWoRN2lGwhJcJbruymR+4A4iiI8Pt/EV1kqhucy2V2IiJ+/wHtno0F4yP9ZGIC8YheqONw7EZ4oUDjtDB8RNytykh8Z9CE2cBecotmJXzVbtLHQzyI8PK5IJqy96R9p9Hyc3pYHH8fTSAbmE/jMfvVIb+xSUHcWit0RiIuZMLMPoF66TGEZQTGOl/fc1KF8+thrdeL/zHotzqXG/1D+UKHIArLXQ16EmfOgViAI9f5jHvvBck8XEzlfBDAMiQRSRlIfS7rK8IOrM8YoSiZpIkrgaahTT+oQrE4jkVJb07JRAbEvZRRf39XAsTigLADG34vhFAczDI0MWy0gmZceVHF5/O7hGtt4V7McNmk4xNUVMq+w4o2T4JlkXDc06P6lK26noC7F9L3JTPSfHmhio0Z+q29uIiIecfL+DxgnOtwG6Q0acH0NRTggHj+93dr+Q+q/VFT5s3Y250yQpx14s2wDfWF49BQedpJoQ3bxR0AhGOzGx2QJuQ5EZiDJ0TfI+jQPf9g+Z1a/XPdWE5vPsDLWj6GOZCERoX6H7YTPuIqL4sX+4IQC5U6NUtVN73Rr+kx8IWaW/eHnmYdI9X3mQnpuZx19Z2JNxGM9FBL8SByUVpZeAb6hsD8XiotAnr040IkxHLnhvLCtHrSxbfbQfwyOnRZWYTSojaxte9meNVLEBJVuFz7tB089vaQ7OH+rBJ1aIJ7+/azqjeJh4As6wk0/thpvh0dwg4vhSJa43bMjeKd/Y+jzQJXgrrBKUF22MQgZ6X4j9t7YA4RNihaFGl/ezX5YSk1dHIpHBlElUZzERrOBo94zMSTLaNHnuIaG1tBPMzRiPOD/imxkKf+UuK9QvHUfi2FC7lYSdcAISPiOWxLu3CrB6zj9WaCq7XOoiT+U3Gx2sB4xeZe07YaG28bq5EFPfPsRhfpf0Z5IdyL67EVkAxNfHjYitvijwqMtXKbn3ra87+FCbZ+X+qq+2bUptlM7+08R7bOCpa7o7554+Bsoqkr6lyjsjIYqBABD8XdW2xqx5fYAdIpchLXfmLwPgl2QVYkR79SCMXp8GHXgJf9Fm8D8cOkffyQy0ZwhPuPGJaBIIfx7rbnaAc15uztosYVVfBymS7lXt8V9XMC/33NJB7ZAbsXyeybGz6Mxx6kx/yipeyCnV62UG+ywFdjnz6LpEL8vln1pfojpCv+XMac2WrtOrKosp2EQvYvMFvBYRStIBCXqkl3X7ahN3my8fH8vxjw4ifUdHA308gH6RCbMQxVNclsI/5jb4iCPO6Beo/OKVLND6/RvTAWyeqVOmLaZUhMbOOHQJJ2SNMLVe0SOQhX8WZEIim3ZWWxX+73SBEW1KLusZzmKs+rEClgwef2la20pcPONvysSU3XWozb+IIIk1rKPvyEoTWzw7/bj7uK9od7qse+Bh3dcoxuMsxYVVUOPDS0VkeBDFg/WUp0Dj4/JnYwHUELzkrnxRAdsMMJt9GgKEqPRevjXoucXt971jAt9yXUARTJnOMcNBtEXx/rxMXSkQUom5MpvJhgm7nW2ZzpzmnqRukzD8KOjVEnZyyEoFqGqYEJMcQtDgcSVVmj4T1nicUqGE+YKzbdBw+h6YhG8kMpa121wzH+b2qaxOmR0Tta92dlApQgJtPPVwxeKNZ9Ih4jiV5VO1JcYOXGkN7GO8kTvCeKrcKZ1EyL8jN5JrIopDvmGiIX6qDfSuiZTaxD8lnu5Go4a1LtJkDrhLXjcNliE8K8Je8ajfbRB0f1tHutDHuaihb8sPFwjs9464opCnQMaeGGsTySJ9qxS+Z3CNB10UY5M0+woewLLsjso1IfiXOw8tqdxqw7bErRsBv79pOscobvwk1jWmd7RtZ0NJzdQWwnyqeYinaZMKCVOsaar5HrMBwINNON1HNzfwTOqjZ5jz4dSOtKeAztwA3Tv7LcExHx3zuyaC2QqMP1+Fz+rELbut/LIzrc2d2giyLErnT+pYtE6J09yIWu47OgadCa0/xmljUZeLcVHJUmwjbSUU8ebf7WJ0DRB912rFY3MMN8qesy1i5mVdCmWmlA1opqx1RtWqWtg3mqU2NcfLX4y9YJDLClVcG6AgqSVHsw9od3MtAYQwD0C0m8LAJ5cq5vsuqtJ0tR/F+g9Bl3GedbY0uJiE58xX0Ifw9lp6C7SxRSEcntyeB5uJphq9GrZ/psyalX77fplVLdStVPZNU+53HhFOqV/8YUL81xGFlkGarcX4DdTIR/kMtDX4XiuAm7c+ZDUrruaPj4bL7HBB5IKfbCcgHwZKkc50RXJiA4uR+oQizvbPpK34DlQNBpB7DdeaAyGCpElLTbTeNgE72D35QM/rO0NlHVbN4UAnz+gP0fSEO07t96AXaYzwf0uRzCiG2WLZNc0b4/ZCDVM7bV09bwpa+JZh9VRMLmT+w/JQv2Z8U2Il67OB5AWDerwih/bKfq9Wo2yBI/jDlKbYwlPO6aBIADyXi+zVUcTq05Wgdip+Mzo9nsBMomLokpk/zHLJ38ciEnxuSTpFk11g7ACzPucGa0okxyoSCSQVopgcRcjVGEdMjiBjkS4ZpPZg9nDJnqu3r49Sal9lw5bPWu36PsgXefh7gBDvEUThrmHTCD8YohjOGBTwqyRYuTYmp7ErAGjQbKpeNFU/4o5v9FK00gx/o+WaHKCkkEYsyCUXlVLYi+Qnf2DYvdjE/dLBPVSIBT+Cfy1Kl3KMHyjEHQohid3Apkw/K0mcpbGTgCAETLJIWrCzj0qs3PeZ00gnXMzo73jfOaeaK5GtG3PH6G8xrAxvn6fuHvBb9QFugyo+Svxa8sGQP3CDlgBXryGhJafeNmjgqPC9jCGzslUT6owfy6kW0PXRkn3dAgG3r1bp5/7zw7IM9Y/2D5gXSMFARIyhK0GZpOPUenLzDtJ4Q+rxD9MXyBXQUX2mqignpwThOo7r/b9LwAIMjGSLryUluzShVhayxHOs7edEdkqYgN0SvecRPORrNYZH+RqhoDOgUYl9tEEUlOb535swmx5+pPCVC7oU7NbRCtNdOV1/WHUdTkxbMlHdrLrlSvJxJiY0jAicEljCKX6jKwzvXWtBQQX2ES81lf6eryRYcqsh4S0AvJT1O9Xq2efuD4uqn3AD8IG+IbDkJIO4CdK5/hCw+sF7TfGhrUDeswi+X8SJeH6Xkyr9EfJHFUyl3Eb+zQUHnB1rOMman3QN/sS/o3Pbl9Xj4OvgzswR01DIWal+1ZNCqcsA7/4sWhnvkdZmD1uTA2xpjAp9TnFFUntWqaeKUMAvWrODbS1qjCs9HvDCkNWCm6ls0e7CNt8WZunkLPTApBhKVnx3heO8cNw/4kWHSxv2wjMlU7e4UYI4lk4lIZrtwBOV+LozaP0SUvIQdAdDokdO93vro0ZEvsjJnjnle/BcvcyXhiEx93fubRb93nIYwk5OG+Br+rk6hItK05FnXFfxuEbkmzrR7dU9QL9CdpS8043giJtCnVgnLTmwsxMCbdgUO7nVnMPtngDG0cG7zL2B8T+skX19OIutHv+H2ruLdKsIKJL5HTPIGoT1aFDIDowFjqVMkuclHi2e8+5QBV9l94qFOWW065wxFb64Nc5R4bj6gl+FandVVfclSq3RLAGFmlo1tz0kQSGNY4mfag51WvjhP3GPWNDBOPxvVntim3jIsSlDQ8RahBXiHTPxNkP7aPzDwkQKvreroL02GjfdRC5PSQ+dOTwt0zbXNQ25VzG9m6R6IC9lr9OFsAl6lPjO2lWFuqHbASSPdLGuZgW/IGZl46mGKjXHLdqWUvIHGI8+e8XBg9dYnPouFP1N9p/DjjQjtfPu1ZDVsm/TZpiquu8svJ2HgQzZ4mWzbYp93eqcT6cGzwigOX3ASN52GmXld8Ty9j5d8lBSIE99m8gvQyRsNYm8utvNqvJIMt4uO6zcPMY/9H4w9JlP0XFn/iM0hLyE7WTYfZjRv2uXZtat6BcPtg2i0YqrxGncpt4Ws88/fgqQafVTEzJwzgi9qGttQOWF7zhonLHBK4yepbhBw5uz1DN5i8s3ZFCES6BfDd/iUSdX99ijwCXQ5U0sDD+o+emClH6eq/A8cJPktD3mQq8ApHmpeN+CejXFkauv7O/siHtL8gW+HaMZLO7uyBk1pzoLpEiUx0FWbxzBArMSL7ftkn2HN3uryvVV2inuaf//8P+O9Uhm9sjrwh7+YYC8lOVJxJ6KAk2ncICmlnj1L0hDo9D6ISZ/GH/IkIIZtaStN6HRosYFsZlj9CQlpZ2sps8fLQfUoMv76oJW3vo8vUFR/w+HRlZY47xvvDELxqbH24V7zJ0H2QoWphyH6EW76sNt3nT42DKtjVpeR5nYLOWBm6OVEipd6cZfCPRGzV6itzHjYQKS+R2qz01Ywewr5/DXIOKwX/5x3I7dNz5EfRHbldcRB+MJvWXyVohmlarW6F58XQsUwv8Wo9rcZgX2buvRuCLih/mBRjdQWnAAEERlK2wklE2kPpXcPMZClMsMEKCueO5yvPv0qOibYaac7kWkKhrTOfdL5W9Mmq5/IckUAKAECuovwwu4KJIHaZ9NKf2Vsi/9eRreZc46kKF6LtQbX0euU9sj+tNGmlhLMdrE8i9wId8ruEezi+tzU//9MRtrikh9WrYAv7J5EL4PahIFC1MfLv+gz7/stPPrP5D5/91VymbMr/uWKzhn0rHWiGprOaD1IUPCmpyhv0KXxOMXaA7uAYyDNAnpVMfAGerRiefFDxOWSJAWaiOjWNjs3JMV8FoeBsSGU1YKu3AL1/+i+MDCLBwcNnRGgwVnwy/lepf5Fhh2Gl7Qz/RiZN879s7RsxcCBMCPGQw6LtLR44zL3AJCa4tEAnhhrEB0LDyrV6rZMYsPBg3TkxIEHvKf8OI+f+u6g9QiXTtHaBr0v7VGbeut+L+MgmlFNbqVaYJalm4xgLqYvS8IGu1LzEbbXR2mAcoo7oX8u4YQH68eBz/B3AlRBEtnsYjOl5dHtY/23FjPRINlaJMrUT8S2K2oJzXmjQ8odkFLqdaorqjtPJyLZg4mbE6GHHssaPYoESk2HcxbOzBgZIn9AfvhRsv74Yv/PKvsBflD+6sBp39JLtHZSudkdWsbj/Ev7dL0McmAK1tokmuFTKYFaMLg+k1fRFj1X4zx60xQ0+xuyqoTj/zhqHwO9KFadPD72kHuOmSKnqBS3es/YRU6OJEdl+0FzhRBnHU+LN9z7qZxDZUIhUeojEuYXu3UFAzzZEsOAwQULGrm4lznWOB7wpvwFQzGk0qimcFiTQkKMEOljeX+BzXDtI814s8Syv1+osga7Z+BrutClTX+fIZ9Z2iSbd4j6cfNGv5QT4+38mfW7ShV76QSGFNGRiq5tNxw8gOu7oSyQ1EzkoImvmGqOFSLiTCshRIyj6yS26WtV9s4yce/P487KJbXResFgVUi9ejivpX0FOxYlc58wdhfrFFpAJbAzM5DkemSnvCkCCbQ5XqDB9Obki/RGdvdyc1+Vb3X0zs8gwjL/9t/cdzLefZ9jZwjCt/fhHgIczsQaeHFcCg3d2nXkbqnmM0WglWa+RJ1c1IHn20YKhYZLT8DEMpW5D2mcn877RaG61IVwh+M63NG9vqTfghOR7K5tFIqjzFZIxorj4mp2x2yuMeNSdysbflAByyzTmJDL7jG1XrbsOqfltPVXpEEjwf8vB0Aecrqq2C4J8B+3Wy61bMPDKWjsE6ZMipNlmTi0r/ZupT2wtzTP3zU1JDmN3FkTZkKgdpZcVgnGCD/KkCZ7A7GoihWAo93b599lGNKYI70OpCdvnfeNbZC186TEe7ZeVKoIEVdjVX454nUizru8LMENhinxhW4FN/NMvk/KZtONyJUDI2YbSV6TMXWqmNr1XJQ5GhLJi1S9xELVehFcEJjpO8NhrQg704VaVYpHYqoWkEwh9poySHJDTLDxI9bcQ/L8dxN5qMPZU6OXUHnKQ6H9njyBTYSIMD3GJM+4xARtZbAuF9yLRAkq9tBV9eB6TKS0i+TMTCKnsJhBTZ8S852M1gdUM2yax0RO4Bt76r56Auforb/c3djuogIAcFEKentwg1nO3cJdhE44NnHx3aLfVvCGBSR3v/Tj6M6AZyCHH2OlOD8+TvgskRQJ95qhf7yvtvfVtbTave3eWrOL7UBx7CGT3rdfFp3QoP9+Yx9Ackf9HVbhs7uYYLnNY2G0Mi5lB0nwFjGQdadDhPiwBMXTXWa4kFdZ9trSA3q5nOlvTXz8fRySSH0K4jOmDdvO95onupuyYzOrqpg2WTiE4SyLO9UOZGTFNrsrvWtgLT1maepqgm5pyYjtSUO1ORXI466n5Jr71QJdbm6ulO0QettobGoxELwXwH/IdRuRm5vozQydFqiVZVGcQvSyEgeeVPynKBT/FDqDVSP8917g6QsDIszJlDu3hNExQAwQ0Ji/tRv0DrELGa8BMg8gHBA1elKCsEabvbkmInTZ9MuIQXENrCQeaIWn/rkshCQxRiEQvEtt7yLE6S7M87POaTfYnROlhfnYtwEv0SqyDmPTmruu469z18q1n06UY/7Ed9R5EHUDerqshurrao33MACckg7WbcR809Te780hTYDibzHCm7rleLyFg9JjivyvHE+Ax6NR/OW6lvqt405yjBdoM8ZQblgoY1l3Z5LvnZ9RPzOtc3GyjqZn7PDBPEy1mDOym4bHhrHF39eYQqww+baWgixeUg8fuoBuco+fWR3PZw+3OJdw8YraY3X0VFNM9r4KeXkagegQI+4feOuuuyAWq52b9mylLwM4IrUNvOb3mBQd0JQWVbrGIaamIuSfw+TiUpU2W6UvK0V0baQCPpN1PpeVTXWJxS0vqqjFpZX+GBI4I9AoV6NV/AxnQplaw/HSXuwMoXHPkhePd1z2ycXQP4nzjH+Lf8UaSmwtAzsPjrrb+vi50L6ltGYtfOwJEoKjdZT548z68u/o1sbzkwfOoi5wY2dUEkuHjV4u4gcqrgLIcg95hCU4It9/yAiLhsJFa8AF9TeXBufA5AgRhAQsUX6zMnJzQoJWzbRaipU58FWlskOGNohmM9ETcEVhRdb2h65J4uLSadSnjRz8p9wlHG9/XCxuLSrueWeuKG1hiirrnXQuvxaxScQVYn50+d/kx9BSjod4pq5LzOMw8SsbIbos/PfVNw65vVb34LG5FhdVu8xJ9e+91RP2WrWVgmL3sIX+ZhH2QmXCXW6+0Y6N6by2/z8VsKe0Or5SRKSPWE1DU3gCub8WsF/7k60PNvRmIqyiz9eCO7rgtXKyhaSbl545BvOu0TUXGZVpqZvmx8NFbpWf3Z9MZz+/QjfLrxrV5FNXpcK+aFpXCuUDJLY47bRZ70/i+gnlQ/ubkkY6j5eGJ6pBrzcU1PPaLdSVmg+gkW0C6Q9fnom2+0U9jHymIKmHioVHUtunDPx+Z5XZkWZxjttYIHNTp7CPS/GnMv27dL9Lz+zpNo/Lkhi5TxUO7GpztLuQ6PCG91X26FuZ8SIHFRfTe4wGTXbtelbb+5XVlcY6hp49wCHPMqXz/RlcZosjgV2rzgh6nnNjejb2c/8xjjZvdCBXTnd1yI888drzl3Il8SacCnn93Ua7yWOjmIi2zGx1pPAaBxq0CZV0/IvmMwA==';

// built: 2021-12-25T12:30:54.115Z
let r = decode_payload(PAYLOAD);
const STOP = read_member_function(r);
const VALID = read_member_function(r);
const IGNORED = read_member_function(r);
const MAPPED = read_mapped_table(r);
const COMBINING_MARKS = read_member_function(r);
const EMOJI_PARSER = r() && emoji_parser_factory(r);

// emoji tokens are as-is
// text tokens are normalized
// note: it's safe to apply to entire 
// string but you'd have to retokenize
function flatten_tokens(tokens) {
	return tokens.flatMap(({e, v}) => e ?? nfc(v));
}

function label_error(cps, message) {
	return new Error(`Disallowed label "${escape_unicode(String.fromCodePoint(...cps))}": ${message}`);
}

// Primary API
// throws TypeError if not a string
// throws Error if not normalizable
// returns a string ready for namehash
function ens_normalize(name) { 
	// 
	// Original Specification: 
	// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
	// "UTS46 with the options transitional=false and useSTD3AsciiRules=true."
	// * IDNA 2003 or 2008 = not-specified
	// * CheckHyphens = true
	// * CheckJoiners = true
	// * CheckBidi = not-specified
	// * ContextJ = not-specified
	// * ContextO = not-specified
	//
	// This Library:
	// * IDNA 2008 w/ an UTS-51 emoji parser
	// * Alternative stops are disallowed
	// * ContextJ = ContextO = true
	// * CheckBidi = yes (if xbidi = no)
	// see: build-tables.js
	//
	// https://www.unicode.org/reports/tr51/
	// https://unicode.org/reports/tr46/#Processing
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// [Processing] 1.) Map
	// [Processing] 2.) Normalize: Normalize the domain_name string to Unicode Normalization Form C.
	// [Processing] 3.) Break: Break the string into labels at U+002E ( . ) FULL STOP.
	const HYPHEN = 0x2D; // HYPHEN MINUS
	let labels = tokenized_idna(explode_cp(name), EMOJI_PARSER, cp => {
		// ignored: Remove the code point from the string. This is equivalent to mapping the code point to an empty string.
		if (STOP(cp)) return;
		if (IGNORED(cp)) return [];
		// deviation: Leave the code point unchanged in the string.
		// valid: Leave the code point unchanged in the string.		
		if (VALID(cp)) return [cp];
		// mapped: Replace the code point in the string by the value for the mapping in Section 5, IDNA Mapping Table.
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return mapped;
		// disallowed: Leave the code point unchanged in the string, and record that there was an error.
		throw new Error(`Disallowed character "${escape_unicode(String.fromCodePoint(cp))}"`);
	}).map(tokens => {
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
					[tokens] = tokenized_idna(cps_decoded, EMOJI_PARSER, cp => VALID(cp) ? [cp] : []);
					let expected = flatten_tokens(tokens);
					if (cps_decoded.length != expected.length || !cps_decoded.every((x, i) => x == expected[i])) throw new Error('not normalized');
				} catch (err) {
					throw label_error(cps, `punycode: ${err.message}`);
				}
				// Otherwise replace the original label in the string by the results of the conversion. 
				cps = cps_decoded;
				// warning: this could be empty
				// warning: this could be "**--"
			}
		}
		// flatten textual part of token to a single list of code-points
		// emoji should be invisible to context and bidi rules
		// could replace emoji w/a generic character 
		let text = tokens.flatMap(({v}) => v ?? []);
		if (cps.length > 0) {
			// [Validity] 1.) The label must be in Unicode Normalization Form NFC.
			// => satsified by nfc() via flatten_label_tokens()
			// [Validity] 2.) If CheckHyphens, the label must not contain a U+002D HYPHEN-MINUS character in both the third and fourth positions.
			// note: we check this here (rather than above) because puny can expand into "aa--bb"
			if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) throw label_error(cps, `invalid label extension`);
			// [Validity] 3.) If CheckHyphens, the label must neither begin nor end with a U+002D HYPHEN-MINUS character.
			if (cps[0] == HYPHEN) throw label_error(cps, `leading hyphen`);
			if (cps[cps.length - 1] == HYPHEN) throw label_error(cps, `trailing hyphen`);		
			// [Validity] 4.) The label must not contain a U+002E ( . ) FULL STOP.
			// => satisfied by [Processing] 3.) Break
			// [Validity] 5.) The label must not begin with a combining mark, that is: General_Category=Mark.
			if (COMBINING_MARKS(cps[0])) throw label_error(cps, `leading combining mark`);
			// [Validity] 6.) For Nontransitional Processing, each value must be either valid or deviation.
			// => satisfied by tokenized_idna()
			// [Validity] 7.) If CheckJoiners, the label must satisify the ContextJ rules
			// this also does ContextO
			try {
				validate_context(text);
			} catch (err) {
				throw label_error(cps, err.message);
			}
			// [Validity] 8.) see below
		}
		return {tokens, cps, text};
	});
	// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
	// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
	/*BIDI*/
	// * The spec is ambiguious regarding when you can determine a domain name is bidi
	// * According to IDNATestV2, this is calculated AFTER puny decoding
	// https://unicode.org/reports/tr46/#Notation
	// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN
	if (labels.some(x => is_bidi_label(x.text))) {
		for (let {text, cps} of labels) {
			try {
				validate_bidi_label(text);
			} catch (err) {
				throw label_error(cps, `bidi: ${err.message}`);
			}
		}
	}
	/*~BIDI*/
	return labels.map(x => String.fromCodePoint(...x.cps)).join('.');
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R💩affy.eth"
// this is much nicer than exposing the predicates
// [{m:[0x72], u:[0x52]},{e:[0x1F4A9],u:[0x1F4A9]},{t:[61,66,66]},{},{t:[65,74,68]}]
function ens_tokenize(name) {
	return tokenized_idna(explode_cp(name), EMOJI_PARSER, cp => {
		if (STOP(cp)) return {};
		if (VALID(cp)) return [cp]; // this gets merged into v
		if (IGNORED(cp)) return {i: cp};
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; 
		return {d: cp};
	})[0];
}

export { ens_normalize, ens_tokenize };
