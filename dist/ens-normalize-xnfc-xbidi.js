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

// my suggested inline ascii-safe unicode escape
// this is ES6 \u{X} without the \u
function quote_cp(cp) {
	return `{${cp.toString(16).padStart(2, '0').toUpperCase()}}`;
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

var PAYLOAD$1 = 'ABIAAQB6AEAAOAAoACYAHwAiABgAFgAOAAsACwAMAY8AfgADApQhCD9xcXFxcXFxcW5hcbsGoY8Bf9URLHl4F4mAXgAn6F1DBPgbACv4ZqZU5nHucWhm/wCYRQRDAJcASQwtAe8FzAOHOfQyBvsC+GifBANGRZDdAC4CJSwCIi8GFTgCJSwmLyQpNix4JTpMcXV+rQEGGggji3raLA6mlfECCAxleXQSxKUjTyElAibgTiIC0gHv1AZQBLNgQ6JNVpJS9wlNAHRfAXiOWADp7D9QqYZpggAHGwscRNcB8gB0/yE9LHw3ZzYcITAjCk8BAlASEDEWAjEMCTgFzVsHDywSYVMEXgVBSgCFDAQFAckCphERETMDM2uMA88yLkEnJgYTLi6LB7kBPw0nVwsQ4gE7YHTHG0MAJpANNxIqJ15uH1IFEQDKAm4FfB2eATAAeIwtpywlOBhEJwRXng4sHLli4Q5IYl7584oYIwciAIlLCW1CAFQULjWxMQNQS/8RUSEBKAMWiQavLFEEUAT7AK0E1WULFc3RYR4GDAkRFRAxEhEDAQEABx8IASgjAAJR4QwFEpUiGzjHDw5ylPEUpACEAX4jBRwWExgAGwkSAkFoCRgIAA5XWI6qYXEEjBQARAEhDhAt2CcBFwASAEoTJBMCNQUSphsCAEEXDnKU8Q4OA70WBRQQHmoJLG5nEwoIDmNYjqphcQSGGgBJASASEDPYKA9QDyQSCgQMShMjAxQGAzUCcRkkAIsAuokwVSwLAmIGPhgnKACLCRkAEicBAQbgO8+xBTABBxcQJgAEQDf6MASDMBD0HwwoDAsu9wDA6hMtcgxWABIITU3k0SHxGPGp8QBhA+dvYj7xAEEFTY2l8Q8x0RWBKEEG8QtKx0dLASBJGLFQ8QBfWx4AFKXRDyrPFXMcIgEPEjzcS9Wn/KALJxnXU2YJOBWKOmP82gdIgmNcRsDi+p7FBLYbwm9Uzs1RfCbNpY30PNDOtZBhbqPBybOPeWa7oi+ySNuja7E79Fz+oJqkWRGdXLqRl46pfoUDu0uKXTiGuFf3GtJzAXtJmxI3V8am/mpQnjfi99U7ZkojTh6fKYexodlCUm8Nn5tkJXqdPwxaQiU29Pa8nQxhFccS0ZzA2p+XNo3r68FBGjQNasxwtQH/0ELiOQLNuyc0YqOxCPnfFsvASXVP7enrn5p48UHDGS6NU/kYR37WSJ7+CN+nV4NqWlRTc/nQOuWoDD2Cnkn26E21fE+79xMXG2voqdtyef5eUY6MOoAAPIvdUDW+i16JSxe2+srXAYVvzbE8SKhyxzjFf2rMlgMycfXR8nl6/xF97xDwBSNLExVnK4YUGbAMpgGeHD0vHVXsIK20HyDdJQ9a5Uhwta5o+Tw/HpthmalqVX7v90SgUzjZaEahH3JPOhT8k+LFPClF+c5gMeKg';

let r$1 = decode_payload(PAYLOAD$1);
const VIRAMA = read_member_function(r$1);
const JOIN_T = read_member_function(r$1);
const JOIN_LD = read_member_function(r$1);
const JOIN_RD = read_member_function(r$1);
const SCRIPT_GREEK = read_member_function(r$1);
const SCRIPT_HEBREW = read_member_function(r$1);
const SCRIPT_HKH = read_member_function(r$1);

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

// this is a polyfill for normalized forms
// it exists because the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
// but lib-nf.js is approx 13KB as of 20211221

function norm(form, cps) {
	return explode_cp(String.fromCodePoint(...cps).normalize(form));
}

function nfc(cps) { return norm('NFC', cps); }

var PAYLOAD = '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';

// built: 2021-12-23T21:04:50.177Z
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
function flatten_label_tokens(tokens) {
	return tokens.flatMap(token => token.e ?? nfc(token.v));
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
		let cps = flatten_label_tokens(tokens);
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
					let expected = flatten_label_tokens(tokens);
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
				// emoji should be invisible to context rules
				// IDEA: replace emoji w/a generic character 
				validate_context(tokens.flatMap(({v}) => v ?? []));
			} catch (err) {
				throw label_error(cps, err.message);
			}
			// [Validity] 8.) see below
		}
		return tokens;
	});
	// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
	// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
	
	return labels.map(tokens => String.fromCodePoint(...flatten_label_tokens(tokens))).join('.');
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R💩affy.eth"
// this is much nicer than exposing the predicates
// [[{m:0x52, to:[0x72]},{e:[0x1F4A9]},{t:[61,66,66]}],[{t:[65,74,68]}]]
function ens_tokenize(name) {
	return tokenized_idna(explode_cp(name), EMOJI_PARSER, cp => {
		if (STOP(cp)) return {};
		if (VALID(cp)) return [cp];
		if (IGNORED(cp)) return {i: cp};
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: cp, u: mapped};
		return {d: cp};
	})[0];
}

export { ens_normalize, ens_tokenize };
