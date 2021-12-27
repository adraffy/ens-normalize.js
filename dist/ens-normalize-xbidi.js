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

function read_member_set(next) {
	let set = new Set(read_ascending(next(), next));
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < vN[i]; j++) {
			set.add(vX[i] + j);
		}
	}
	return set;
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

function read_zero_terminated_array(next) {
	let v = [];
	while (true) {
		let i = next();
		if (i == 0) break;
		v.push(i);
	}
	return v;
}

function read_transposed(n, w, next, lookup) {
	let m = Array(n).fill().map(() => []);
	for (let i = 0; i < w; i++) {
		read_deltas(n, next).forEach((x, j) => m[j].push(lookup ? lookup[x] : x));
	}
	return m;
}
 
function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let vN = read_zero_terminated_array(next);
	let m = read_transposed(vN.length, 1+w, next);
	return m.map((v, i) => [v[0], v.slice(1), vN[i], dx, dy]);
}

function read_replacement_table(w, next) { 
	let n = 1 + next();
	let m = read_transposed(n, 1+w, next);
	return m.map(v => [v[0], v.slice(1)]);
}

function read_zwj_seqs(next, lookup) {
	let seqs = [];
	while (true) {
		let lens = read_zero_terminated_array(next);
		if (lens.length == 0) break;
		let n = 1 + next();
		seqs.push(...lens.reduce(
			(m, w) => read_transposed(n, w, next, lookup).map((v, i) => m[i].concat(0x200D, v)), 
			read_transposed(n, lens.shift(), next, lookup)
		));
	}
	return new Set(seqs.map(v => String.fromCodePoint(...v)));
}

/*


/*
function read_ys_transposed1(n, w, next) {
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

function read_replacement_table1(w, next) { 
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i])])
}

function read_linear_table1(w, next) {
	let dx = 1 + next();
	let dy = next();
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i]), vN[i], dx, dy]);
}

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

export function read_member_function(r) {
	let table = read_member_table(r);
	return cp => lookup_member(table, cp);
}

export function lookup_member(table, cp) {
	for (let [x, n] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (d < n) return true;
	}
	return false;
}
*/

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

var PAYLOAD$2 = 'ABMCuQDBCCEAOQDaACcAcgAZAC0AFwAtABEAJgAOACUEiQNRALQNRycbxexVsVUCJRieAuAASPZlZwBu4QoILXBwcHDwcAJrCe2iQYxsZfepR1yjAE1t7ecAc/kC78r4ABIsL4ogCD5wcHBwcHBwcG1gcLoGoI4BftQRK3l3Foh/XQAm511CBPcaKvdlpVPlcO1wZ2X+AJdEA0IAlgBIDCwB7gXLA4Y49DEG+gL3BKEEogSjBKQEpQSmBKcEqASpBKoErAStBK4EsASyBLP6DwU8AZUFPQGVBT4BlQUJJgUKJgULJgVCBUMFYQYCC0YLRw0pDTkNqQ25DmIOYw5rDmUcwQISHL8CDAsOANBWHOsRICQEgguHdDSa1kwE03+3B57NVy6SAHHFGgHZiLxWOdMGHR2cA1UoEQIHAAE5o9IADjAmDgUPCo0BAgMAhy9T7BAPwR4WNgSLAxJ8FeQvHwDQXgSfEesWchzoGAI3AQFEBQAQPJyVqZ0MzwBNzQBEAGUE9wHThG8DMQFePhmdA1cmA8rNQEkB8S0DABD/VTNpN5IbYx4ASAUfAscGCCuSAFMOuAHvCwThd4QaQgDgAMJSUgQ4CJ4Ad40AqAFWVrBlRRWIDK4D+gCsBUgFFRACAQIGLhmOESYCTRmKHL4CTgI2BXE4cQVDAK1DAvqfodmRADcE8Tj1Hv2R+0wAFKkaoxW5NmMA8P8BnQL6mRk7PwAhUwAzAD4pOTZc5AL7CmUCjtcChw4/xAM2zwKEKALUBXdTBQM2xW0HAQEBAQUBQwCumwL5PwUXpAPs6QTbK4BXUj00AgU6BUkEpgTbBazlABX3SZhOnQL0Ot5ALgpXCclv8XeEBnMQTSfXESkMZQHnAW0OH0wKBSMGbQT7H68ZSw//lc4I1y4PDR8nFS7TgIwkJyq1Bh9MJj0PC39Rmg+LC5cKFTqVgYADUwE/Ir0LDw1rCJ8RJQr7nQ4XEXcHawQHScwA1wczC0MdZxXnJkJi3gs7OakHLRsoC8Em4RNbey4GBRpTBn8BWxsxAQEvGYXiWmNcThBPkQY1C1cj+RTaUFINV0DpeHoaTQdHJdsCw0OiSrlRaB7FIig8bw2YLkVRrggnPDcZgQuzPNBG3UVAEgQ+vz16IntMXgRnsSxhJ70KAQ+3DOt8pAGLCVMJ4wyjE2MRSTf3CGsHS1+XVidHCFNGx2DMBSnRBCUUAwM9BXEJcwdFA+ccXxNgFVsFP4FWAAkDJTcHLuUCwVayAUkF/Q9XIBEQgkgSDxsIzQKXA7UmHQBfFVMASSLNCHWVAJGQClM3Lv0I+WqeI6YDmRUZkxGlB8MOiQfZHGUV8R0TcPpePYY6KNXhCY0BpwnLAZEFFQg7NY2M0iBzZ4WLihjNIJNBcV4uAmMMlxXRRO+HqgK9D50STQFnAaUHaw0zAqkSHxGdFRDHCR2GNjXnNCo6VwSBIbUgQwpZA4FtAAtZJysNKpsB1RKUAz40b3ggZ91g6FYYLwdLMvdBkiIjC8RP/wzOGvMYdFRgGhYH8QQlGyUoHEGJBjED1TVFOn80IATvC5sIvQlxAHsO1QtJCAkYnAqjjQIBY70B6SfLA4nDtQKhwQZpBQc9AJk9uQWrABcATwLZCNUANwEBA4kAawLfB88ASwcBALdzAW8DWRthAVMAFwLBA8UIY/0Bx2ECJVsETfUMRwEpaW58AsPjAoCcZtQGD4oCwAJ7ZwF/VwQ3gHmDA+GjABMRAQ0AfQZFABF5AUfdfP1MABV1AhGhXQD5AS0AN2cHN3MB/wIlEJ8A6QGRC2MJ1OXnAX8AG1sAtQBHEyOdBAIJArsBDwBnALEAIwGFAH8FiwArBgUCgXsRAUNjSl0SiZMB7QNRAWUBPwCrBv2/1/s5CVEEnwgFAhBNFhMC72AH5zMDIxET/0L3Ar4Qh6GSAwJkswJidI0Lf+EvjSA3UgKiKQJoyhEXAmY7Ap+2OE09AmZtAmZYCwSgBLEDA39FA37EDTk4OakHSTm0OlUnHStVAQMjBQJsTwIyaDg8GwJt+QJt4BsAIbwRMWWZJXcRXRUBDwGZARABEwB8NwfKDL8BMD0j9AA/5wJ3YQJ21A8ZAXECeX11AnjsTwmOAA1F4A1HCQJ8cQJ6+hsPCQJ9OwJ9IgWLBVJIMkivDZVWAoGfAoAyAoA3An/gE0mKSo1HG0lK/gLRMwLQ/ktZGQOIgQOIGET3kWQC8tNdNQMD4ANMAExfVwU1AAFNfixN4QKLcQKLCvNNGTkMB08ZJQd1mTfpAo5pAo6OcsknswKPCwKOjqooUeZTZxsvPFMGVLcrApQtApM+ARsATlVQVeFWAjgsTSnHuDMTeJhFbWsGApfRAu/kWFPaAItXApbBApauzgDbWd5aO7N/AG0ClucCloBcdl0DApn9ApmWXPxdOUsCnM059DrPApxIAp/NAp7qDbwAT0FjXEEPCwKeIwKexADnb2FmYiECnwUCoKAB2wKe0VECnoDXJmP6ZFlXXQIn4QImsAKhLQKgfgKjDwKh9gsnAqZhAqYAGwKoMQCvAqgkE2iuaOMANRsbGXtqTmsDAq0VAqzgAq2ZAq00AldPAlYOArITHwAJAx+ACWzJArLvPyUCsxhHbRJtlW16kQMl/wK2jm1xbsIDKXcCuJACuXlHArlcqXBocRMFAr1LArwMcMgDMkMCvrpyNAMzowK+THNUc4ErAsP9AsM2c7R0fWd3dRIDPNkvAzzMAz3xAsWuAsZ5AsZCuwcCyJuDAsh2AsmBAslgAmTPAt4EeKuTeOB5V0wCAxjVDWc0AwJiJhollVZ7PRVexF7tBUMCz50Cz55hfYUABAAlRdEA+N8RAs+lAVsAHANORH59NwLcWQLbvALSgQNSjgNTkQEzA1W+gLsJB3Ey/UgAH5J3J4JOgwUxgwCDvwLa+QLaEIRChHunbgOG1wBhA2RAA4ajiwArAIcC35cC3uodpakC4mHtRgHzYg5ZAfTNAfMEuQLsJScC6aKrMQLrKwLrFgEreQHrKQLuuwLrzpbclzUC7nEDhhKYq3EScdMC8zUAmwOOSAGZxQL3RQORoAOSuQL3ygL6CwL4mJpOmt3tJ2mbUAOdtQL/LAFNAGufTi+f5QMFvwOmnAOnCwED9wMGnKG6ojcFOwMMewLyAHE1DSsBE3MlJUkHMR8hhQ0BQwAlEwOdATnJEZk3AMURX13p4e8ADQG7BQsFAxUFC8sUsUMEawItFy9bIScfBzdTDs8J0R8FDR8Aky8HKYkP9wMpAc8A6QXrAG89n3MBYDEwMTAxLDEwMTAxMDEuMS4xMDEwMTAxMDEsMTAxMDEwMS4xLjEwMTAxMDEwMS4xLjEwMTAxLDEwMTAxLjEwMTAxKjEwMTAxLjEwMTAxMDEuMTAxLjEwMTAxMDEwMTAxLDEsMTAxMDEwMUYxJDFYMSAxJDEkMb8xMDEwMTAxYDEBdQGyMQAuMSgxKDEB51gApwNANjEiMZ8xLjEMMQBeMTAxKDEwMSgxMDEkMTAxKjEwMSoxMDE0MS4xSDE+MSgx0zEyMQA8MQJvApwxBA8DsATDM1IJCRUUCQN3ChkHBjE3KAdTrjE8MTAxJjEANwB2MS4xLjEwMSQxAEUAaDFEMTAxMDEoMSgxAqkzMjcABxgTA50BLAMAITwL9zQPASk80Vnx4+kAFwHDBSZTc3QzBSYAGxSxQzTyMS4xMDEwMbsxADYxMDEwMTAxMDEATQCMMTAxAncCtjEuMS4xMDEwMTAxMDEuMb0xADgxMDEwMS4xOoU6xjEwMS4xMDEwMS4xMDEwMTAxvzEwMZ8A6jEwMSwxMDE6wTsCMS4xMDEAvzjzOw4xMDEwMTAxLjEwMTAxANcBGjEwMS4xMDEwMTAxMDEuMTAxLjEuMTAxMDEUCQD9AWwxMDGzMTAxMDEwMTptOi46KzuoMTAxMDG7MTAxMDEwMTqNO9AxMDEkMTAxuzEwMTAxMDE6oTlKAYgxMDEBZQGeMTAxMDEwMQVhNY810DXfNZg1pzXoNfc1tDXDNgQ2EzXQNd82IDYvNeQ18zY0NkM1+DYHNkg2WTYQNh82YDZvNmA1XxNTNmw2bzZuNvs3OgTCPIk2agIDNw83UjdBNvwTEhNSN7s3YgQ8BOI8mTZWN0s3ngU6v2lTIR9DBkM5GEMSQz0LJ04ZMQ9BCc1anw1agwdVOCMCAOmxAOniGgUDARRbBQAJAxsB1QDvBekAbzWlBPErPgAAKz4AADU+ADMoBDE6NTI7PD0mBj0mAAQ9JgY7JicmAis8Dw4ABwgBKTgBBg0bJDE2AAEBAwIFhwTB9SMm8QElICMmACciI+/vGBfDI9cbAqF2CV/jFP8vECwpDVApDQRKSUQpJi9ONQ0MLktIKSgpDUgAKS5LRCkoKQ0CCUgxNikoMw1CKSQAAwMrJAMlJAADAzEkAAMxNjckERhzThhzThgVGBUYc04Yc04Yc04Yc04YFRgVGHNMGHNOGHNOGHN0e25zbnt6e3pzaHVoc2gXTWgZGHt6ewpZs1S6BQYBFOfLAx8jAbcECwDVBfMAb1sDCgMHCNBEGAPVCxoTzzEPCEl0bfPuvtUITbpVYVJlxVlu6xi8yukTEkTF+I1Bz4RYE53KIyT5DqAze0PwJQnlNxSS1YcpXV+gDEc/C4oNhoy1Ki91qpqCkt0JC6govLXTaVPJD3AwcKH0Xt5qRPRA5eQ6MH8VyPygTIkcSo7sGVE7g/x/2GhuMYWGguyR28kVFce6ihYPUY3W6nXi+/cnjI84LZxeebblXdW5a64/eDHo767XonxSFZGrp5Lgailtk2xq6j5ycujrl9qokkhmb2lwNH56X+6DnQ2pS+S00ufS1dIKqoNMdSmVRVXuUTS8bAdxZpjBZ3GYbUwUd2Gf7NGiMRzjH9sHUU7IFiCwTVgrpwkZsQzAxyaDuftBHFMUbRZ2SqzQoyN8vokQdZdxrQbnZiew5ZTkws54Niofx8wx3MZWJmmaphy/s3augdBb6bMYJK0V8dEraJiQOltirvSWU9Eyc0xfVhTTKdBbeJpnj+5Oj55jy36RY1GRX1MXuQ6d9K5XaR6kBt5bVdj7wQgTqFSwDbmxadyzHfcLdn0lzacx9l+VnyWca+zvr8ky4UAdX7vzBM0CmNNAMhVgcEwdk04NiGGUFPp2qkZQSAh2t+U/OGae4/9NzQa7denjPny3g473yswQVIQLqQCG5RDqpjP4o/xBLx+i2gGQIKO1b6vMN1LATETLBn6qRF2P9SuRORVQeyyMO0zL0+FDTc/n6Sgc/ifEjrUsjHmIfkDkWG7xk4c3bvXSmCUsWxnTx0Z2CedkEM6ZwrfWZ6xaHbLJTtdymk0w0Yx+ozu5gupZB9TNnG9SKZ0QRO30y3vZq/JiCBMyeKXb7KFzP1Sbjhobjrz4ouE7+f4E+1fsM2CNF+XeR/pHiMOSqRfST7NkOyTnKYRJmzyBN7K/Qg/cLptbCWstC7oKhEBw4gE39yLzFy/H2J7LAGHff6chBHUNw8oBFpyoLqlqf0VApfS05bqP4Nk4YrTmNXHol41ujxa/pPxdkQNuev8181lcbbM+CYhQkf6YvG5pOgQUg2rYPiVOMk0IFziGpe/MYh+hx8RvUqkY5fOn/RLoPlBjGK7EF6C7tiirGnaesifWo3UkZ7YKuBzQ/VY9OCL++CeMyjCgyh9t1k3c84D5s93yf+n6q9itHlOXoY42LHOrx9PekKouVooYd4H7oXv7qndtr7Qxtz6ZFiFehmjQ8TUlBN7gLEy4ldleZoGzXnBYw5UCtayPK2O8nbFIe2WuVQudXSzkxihUyv7/d4Uy+JvXxqUGz7eQSo3+YgzSuhz/oM3SJCyNd6unJIwWI0UpPXmgOscRHl52BSX1ChjrJmd8JF+jxfUnAl/Y1Vl7OOycKSdzZnDNIhhjt0DFpwg2+yqNwuJ+1+AtEvvqO/8maMw655nlQ9/4+C4F7sg+ixD9l2v5t1KsuV3TCUGJL1VvM0WWRKKYTlPbR1uX8OJ6/YWm6YwAPFE0ElXSuTwKdEsVA29ur6n6SurYeHbdJKVmImFDAoCvCIZKT73AAguPi9embsaMrFmiIBdsznlKVEpXJhxFDb73WO1JIlG+3jjreBnY53LHLFlOxSB8uamE3mBo9Hi71J/nL88SKUVr9FiUZDM9i1jV8u/M6C7Aa1STDyVwNoCrdPduWFMUSTEW2ORxNk0KEeWAGigBCZ0uQZWEKUXYSLYQzbw6DbiEye/cz9nLqM2iOzOo+pvFqngmBMGV1SZApeEwBcc0OBUlvG/1tuGhVhBxGwYYtqsLkIiQ8FO+A1211X0QJDn6GHLaXEj8rkw9cIYtXrTmwXtyzcmt/eUoAS/CtdaE8DxJlKaf+XRUpSZrUISDsE3T787UDsFAphCizRPUiSeewa+lq53P71ted+SnbPJX4WY4LIgnp2i4Mtsb3RoH8EvwLyl4ZCEks8KEvQnSm5B+J7KC943c8Nuyc/+oXVr3IBLJVsExQqolVUFA4ycod2Y9nhcfbnu8IU82JpIGcaH39i15p4tt5xscCraP5fD1bm8vJetXWZf6ANxe7mIZe9rS00KAVDBJ9Avm4cTq9LAy1KfFMowSMv8zdHHOpQiCaVLP21ysT5RFdVOF72MfyEK2T3l4t9ilzq7txXCE/dBu8OoLT3Ug+2Exxlg1NCuBbSPYtaHpwzbAu9TPVA/QtpIPuxOpgo3ytxtnAZSIGZ/xOKxTDZAx/xlABsvwB3mNpClAUrj70BlyVbEDpCTlfc7+otbovSbzpKU+/cGaPQ5IilEgwwC/+ZG6dumtH25+bRMaLtGa2VkQd+JU1BSRCKJ8VGbzvw0bX6yG3zh9wtFfgLofG2xZPbz9z+HmAjXaC4P4x4d+xmWjCzwKe19s8x5TeasMAeCcS9JPCC3Z2GZTMLbvRmvV/bctlSf5KUT0sNpYTGYJjzwKr8VXzOBmr9QjTGOg6RbCb3bz+Gz//YK6X9htjxHlDo2KX/BamwU0XkWz5T34wdGnawCFAYSJoFvfe6VluZ4Ftz4Q9epbE3cILgM9J6gatoIwrOrf6E9KeqU0MBH/k4DYy7yI52YBoZR/uzoryViLQ0Gcm5sE/z0+0aIiz0VBjF/AN4y27UV1GzGYcBhdCN+DVLKCLG/PSD4aj3C2bNxJF1ulVxu021HdlUIP0vSIcgUXYXxmhyPknJredXe19NvbQCDQVh/L3SzACD+aHRFbvouhbY2dZLE2TI/twwr70Mx9nTZ06kLSEqf4utlWqEtXnqLB5S9h/3Bw8p/AzfT+fzmT6co=';

let r$2 = decode_payload(PAYLOAD$2);
const COMBINING_RANK = Array(1 + r$2()).fill().map(() => read_member_set(r$2));
const DECOMP = read_mapped_table(r$2);
const COMP_EXCLUSIONS = read_member_set(r$2);

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

var PAYLOAD$1 = 'ABIAAQB6AEAAOAAoACYAHwAiABgAFgAOAAsACwAMAY8AfgADApQhCD9xcXFxcXFxcW5hcbsGoY8Bf9URLHl4F4mAXgAn6F1DBPgbACv4ZqZU5nHucWhm/wCYRQRDAJcASQwtAe8FzAOHOfQyBvsC+GifBANGRZDdAC4CJSwCIi8GFTgCJSwmLyQpNix4JTpMcXV+rQEGGggji3raLA6mlfECCAxleXQSxKUjTyElAibgTiIC0gHv1AZQBLNgQ6JNVpJS9wlNAHRfAXiOWADp7D9QqYZpggAHGwscRNcB8gB0/yE9LHw3ZzYcITAjCk8BAlASEDEWAjEMCTgFzVsHDywSYVMEXgVBSgCFDAQFAckCphERETMDM2uMA88yLkEnJgYTLi6LB7kBPw0nVwsQ4gE7YHTHG0MAJpANNxIqJ15uH1IFEQDKAm4FfB2eATAAeIwtpywlOBhEJwRXng4sHLli4Q5IYl7584oYIwciAIlLCW1CAFQULjWxMQNQS/8RUSEBKAMWiQavLFEEUAT7AK0E1WULFc3RYR4GDAkRFRAxEhEDAQEABx8IASgjAAJR4QwFEpUiGzjHDw5ylPEUpACEAX4jBRwWExgAGwkSAkFoCRgIAA5XWI6qYXEEjBQARAEhDhAt2CcBFwASAEoTJBMCNQUSphsCAEEXDnKU8Q4OA70WBRQQHmoJLG5nEwoIDmNYjqphcQSGGgBJASASEDPYKA9QDyQSCgQMShMjAxQGAzUCcRkkAIsAuokwVSwLAmIGPhgnKACLCRkAEicBAQbgO8+xBTABBxcQJgAEQDf6MASDMBD0HwwoDAsu9wDA6hMtcgxWABIITU3k0SHxGPGp8QBhA+dvYj7xAEEFTY2l8Q8x0RWBKEEG8QtKx0dLASBJGLFQ8QBfWx4AFKXRDyrPFXMcIgEPEjzcS9Wn/KALJxnXU2YJOBWKOmP82gdIgmNcRsDi+p7FBLYbwm9Uzs1RfCbNpY30PNDOtZBhbqPBybOPeWa7oi+ySNuja7E79Fz+oJqkWRGdXLqRl46pfoUDu0uKXTiGuFf3GtJzAXtJmxI3V8am/mpQnjfi99U7ZkojTh6fKYexodlCUm8Nn5tkJXqdPwxaQiU29Pa8nQxhFccS0ZzA2p+XNo3r68FBGjQNasxwtQH/0ELiOQLNuyc0YqOxCPnfFsvASXVP7enrn5p48UHDGS6NU/kYR37WSJ7+CN+nV4NqWlRTc/nQOuWoDD2Cnkn26E21fE+79xMXG2voqdtyef5eUY6MOoAAPIvdUDW+i16JSxe2+srXAYVvzbE8SKhyxzjFf2rMlgMycfXR8nl6/xF97xDwBSNLExVnK4YUGbAMpgGeHD0vHVXsIK20HyDdJQ9a5Uhwta5o+Tw/HpthmalqVX7v90SgUzjZaEahH3JPOhT8k+LFPClF+c5gMeKg';

let r$1 = decode_payload(PAYLOAD$1);
const VIRAMA = read_member_set(r$1);
const JOIN_T = read_member_set(r$1);
const JOIN_LD = read_member_set(r$1);
const JOIN_RD = read_member_set(r$1);
const SCRIPT_GREEK = read_member_set(r$1);
const SCRIPT_HEBREW = read_member_set(r$1);
const SCRIPT_HKH = read_member_set(r$1);

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
				if (i > 0 && VIRAMA.has(cps[i - 1])) continue;
				// If RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D})) Then True;
				if (i > 0 && i < e) { // there is room on either side
					let head = i - 1;
					while (head > 0 && JOIN_T.has(cps[head])) head--; // T*
					if (JOIN_LD.has(cps[head])) { // L or D
						let tail = i + 1;
						while (tail < e && JOIN_T.has(cps[tail])) tail++; // T*
						if (JOIN_RD.has(cps[tail])) { // R or D
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
				if (i > 0 && VIRAMA.has(cps[i-1])) continue;
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
				if (i < e && SCRIPT_GREEK.has(cps[i+1])) continue; 
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
				if (i > 0 && SCRIPT_HEBREW.has(cps[i-1])) continue;
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
	if (cps.includes(0x30FB) && !cps.some(cp => SCRIPT_HKH.has(cp))) {
		throw new Error(`Disallowed katakana`);
	}
}

var PAYLOAD = 'ADsNlQQrD7UA3gHuAGABPADoAO4AegCyAEQAcgArAGYASgBvACwAcAAbAFQAHgA6ACEANwAWAE8AFgAlABoAOAAtADcAEgAeABkARgAJAB8ADwAWAAwAHQARABYAFwA4ADYAMwArADUAEQAtABAAGgSZBVUA5BHvAUFSEmccDzEA/gB9PGlOACh2AgMaAVowA98BmAFQezsCACBiADIAP84xBLvKANV0zVAbl0/exQIdAlKrA2hQAMsDsABjfC4qEpAAOABFAY0ABh4BZQE+uY0FkhESJtAZW9ABKUYHHQwyAg4XGxNaJAU7CAgTRQIOGEjLEgINKQE2GSgYCAkYSAhLMw+dKxgDkQAd3wN4NRcA7SAsYxgA2BjIVZjYJRoKKw4IGBgXCCkoTNYCwQCoAMgoKEAALw0ACGgoKAYKCAhIiAgAGBgICC4ZETUIWBgYeAAYCAiIiAcYGCgAGB8ACOgDSAnYOBLIIsgBCBgIAatoFwgZFsgDyCG4ABgJWDgRKwmYAygDJ8iiABgD6JgaBXg4RwB6Oh0AHZoH16XIDwioFVgwGCkIIwMtEj0SFhEBCx4BNBMhDgcVPAAIAB4mGIhVVdUQDgkRKmxDPv8AEQ8EDQMTDgkBAwcSEQJijCkC9wEPAQEXEwEWwAOe6wBUMwKNLKWoDwGmFUob+RITdgFqE4gGxB3dYxbU5L29aAtDKLgZS6sAKxkB51l9AQscVw/fI68/AWEJaQnhpxMEj3UTA8sH3cUGPwP/77OcjQBpew0EawkJMQeNACkASQKjCF0XCaoJykkBBSDdCMk3A78USQD3O3mxaQAPiyYAJQGFMbUAIwkAWABzCAErG+ceJhfnIx/6AoECoAK3ND84DAVFBWoFQwGEN6kJaQk+ID8JnwmgLClNBwgVUqqg00P8CTlmyqPmPAAfMQAqCvorX1sJZgCl5wApAEcBBJ68cTARAIoBFMkWyaoJAdrGBWkF7gLQrQLEvgEJCloqpHMUgRp7FZE2OxQAyTEnBR0RnQBJmdkdNy/JACkACQA7pysA/RVxn/FzSQANVwWlzXEWIwDMUQESk18AyzEnBR0RAoYE25nZHTcHkDnxAAkAKQs2FAWIVsGf8XNJAA1XBQBBehU9Bw4GC5k7ApOXQOELAK5dAXUArxsD5QCweQE/vxMX+SsAC5kFSwA2mzkO9tgfDNbPABQDoqIXCj0Cjq8ChuY/nAM2pwKEAAEt0xcA8PEAkwFPAjsA7IebCi8DCo6dYwBXAPAKLwAl4sfWGgpUAPlrCx0LIwshBeEAHQBFORuhGYcnTxTtAj8nFdEAEQ8AgQB1Q7WZBZ8Bzwqvs8MBKXGPAX0AExcJ5hkAbwMNBY+Z91e1BC0AHXkOlQCYjd8BhSs7A6kAdQXPAQMhiwV/Bd5F6eACiQBga8EAWgBlAGYAdQB4AH8AdAB/AHgAjQB6OYgdClRXUxoADFRhUxAATADbFAKwAtcC3AKdArYDA8UAFQDIAEXBVgSyBPMSTzI5FOk7ATdqGBwAQpkASpzT0AG/AaQCMQIuOAs4CAK3AqwAiQDbApA4IzQkAro4JzhABWfBAp4CpgKtAZIBoQK0Ars09TSEKDT5NJQkAGI1qzgMBUU0GzQyAzYNNlAENpU2VjZdNiI2+aI9YDsCiwKqArkBMAA+BWcFZr3IBXcFgEItVsdStDTtNMggCQpTC1bgV8Ole6FmbaIGGSED0xUz/4UBBTEEsVkCYWECgym5NQGdsbNDaQNTJQSRbxcA3wkGuU09MQkHNwJHawB5AW8tfwCRKycAowFXxQA1dyUBvdMDRTsvUQthAX1nBnMFAnMA/1clAzcPEwBXTwC5BwBrAIEAOcMGFQAB/SebjQ0AFy8ANwDBKVUFAd8B6RUZP5eGCUrhzhBtEGoPDE0XTHpIFRkCug+0C/MRIwzfKtlfqwf5A2EH+QNhA2EH+Qf5A2EH+QNhA2EDYQNhHBjwKOHOEG0PVgR7BZwFmQTkCJEmVxGPBzYI4FQbdCwcVQNTAQojM0kqO6EzGSVQTBpNEQgKNlBstX1GA1UxuVUDkLAD2TJdOXoPDB5/Eq4AOA+BKjXDTox6VXGuCllPvFgAAEUPABK0ABLvAEkWMQBQNQZGAEjsNOEAE08ATaQATdMATGYhAEpxBukAUGAAUJcAUFIAEj9JcE51Asw6tkAGCi8JoW/Jd1wGSxAlJ68RAQw9Ab8BRQ33S+IE+wZFBNMfhxkjD9eVpgivLecM9ybtLquAZCP/Ko0F90v+POcLV1FyD2MLbwntOm2BWAMrARcilQrnDUMIdxD9CtN1De8RTwdDA99JpACvBwsLGx0/Fb8mGmK2CxM5gQcFGwALmSa5EzN7BgXdGisGVwEzGwkA2S7xhbpaO1wmT2kGDQsvI9EUslAqDS9AwXhSGiUHHyWzAptDekqRUUAenSIAPEcNcC4dUYYH/zwPGVkLizyoRrVFGBHcPpc9UiJTTDYEP4ksOSeVCdkPjwzDfHwBYwkrCbsMexM7ESE3zwhDByM3ly4nHwgrRp9gpAUBqQP9E9sDFQVJCUsHHQO/HDcTOBUzBReBLuEC/TbfLr0CmVaKASEF1Q8vH+kQWkfqDvMIpQJvA40l9QA3FSsAISKlCE1tAGmP4lMPLtUI0Wp2I34DcRTxaxF9B5sOYQexHD0VyRzrcNJeFYYSKK25CWUBfwmjAWkE7QgTNWWMqiBLZ12LYhilIGtBSV4GAjsMbxWpRMeHggKVD3USJQE/AX0HQw0LAoER9xF1EJ8I9YYONb80AjovBFkhjSAbCjEDWWzYCzEnAw0CcwGtEmwDFjRHd/hntWDALhgHByMyz0FqIfsLnE/XDKYayxhMVDgZ7gfJA/0a/Sf0QWEGCQOtDR06VzP4BMcLcwiVCUkAUw6tIQfhGHQKe4zaATuVAcGjA2GbjQJ5mQZBBxUAcRWRBYPvACcCsQitAA8A2QNhAEMCtwenACMAj0sBRwMxOQEr7wKZA50IO9UBnzkB/TMEJc0MHwEBQW5UAsO7AoB0ZqwF52ICmAJTPwFXLwQPWFFbA7l76wDlAFUGHelRAR+1VNUk7U0B6Xk1ANEBBQAPPwcPSwHXAf13AMEBaQs7Cay9vwFX8zMAjQAfdQHhApMA5wA/AIn7AV0AVwVjAAMF3QJZUwEbOyI1YWsBxQMpAT0BFwCDBtWXr9MRKQR3B90CECUV6wLvOAe/CwMi6RPXQs8CvehfADIgAGkMFGBlaj0QO3xe4gIvVABQ7wBQTDSjNTpfUj8BsAGzMgMCt/kBbbQASQgCt/cCt7YCt7kCuuTWAtsCt+UCt9gZAFBLAFBIBlKbUowCt60CvEIATQDVAcsDoTFhLFYDA8leVjEvsgp2X09h9QywDd5E0jpTE+VgW2A8E9ItwRTLFdglYBlHGsYnDyXuVRMPDi3dZjoINjR/F8YASSlyg0tjkB46ClUc8VObVQItJQC7S6wzuQ22Gx9ESgVRdfdiNBYYAkKXAk36AmSLAmJMZVe5B2U3KgKiAQJoogJmEwKfjjglFQJmRQJmMAR4BIkDfx0Dfpw5EDmBITmMOi0DLQJsIwIyQDgUAm3RAm24+ZQJPXFPNQFxAOgA6wBUDweiDJcBCBXMABe/Anc5AnasSQJ5VU0CeMQnZuVFuEb9AnxJAnrSAn0TAnz6AUgKSIdtLgA1H0liSmUfIUrWAtELAtDWSzEDiFkDh/BEz5E8AvKrXQ0DA7hL2Ew3Lw3ZTVYETbkCi0kCiuLLJREnTXEPwQKOQQKOZkqhiwKO4wKOZoIAUb5TPwcUUt5UjwMClAUCkxYA8wAmVShVuVXaECwlKZ+QMut4cEVFQwKXqQLvvFgrsgBjLwKWmQKWhqYAs1m2WhOLVwBFApa/ApZYXE5c2wKZ1QKZblzUXREjApylOcw6pwKcIAKfpQKewpQAJxk7NBkCnfsCnpwAv0dhPmH5Ap7dAqB4AbMCnqkpAp5Yr2PSZDEvNQInuQImiAKhBQKgVuECpjkCpdgCqAkAhwKn/GiGaLsADVNqJmrbAqztAqy4Aq1xAq0MAlcnAlXmArHr4QMfWGyhArLHFwKy8B9s6m1tbVJpAyXXArZmRUlumgMpTwK4aAK5UR8CuTSBcEBw6wK9IwMtvAMyGwK+knIMAzN7Ar4kcyxzWQMCw9UCww5zjHRVP0906gM8sQcDPKQDPckCxYYCxlECxhqTAshzWwLITgLJWQLJOAJkpwLd3HiDa3i4eS9L2gMYrWcMAmH+Gf2VLnsVXpxexRsCz3UCz3Y5VV3c/R2pANC3As99ATP0A04cflUPAtwxAtuUAtJZA1JmA1NpAQsDVZaAk0kK1SD3ak9/CYLYg5cC2tEC2eiEGoRTp0YDhq8AOQNkGIZ7YwADAF8C328C3sJ9gQLiOe0eAfM6MQH0pQHy3JEC6/0C6XqDCQLrAwLq7gEDUQHDAQLukwLrppa0lw0C7kkDheqYg3DqcasC8w0AcwOOIJmdAvcdA5F4A5KRAveiAvnjAvhwmiaatcVBmygDnY0C/wQBJQBDnyYHn70DBZcDpnQDpuMA288DBnShkqIPEwMMUwFXASkCvwNPAKUEicNxDwDFBHXJG5UciwCNFQAhpUcEpxchiQFtAzErAIz55Q8A5q0BEambA29hA4MATQvHwgRfrc8MALUFH8kM9ytLTAsdJjvjOzZGNt020jZPNkI2+TbmNlM2LjcZNyIFdlZfdR9fygCW0wVAAJBaJ5vHOzRgQB+63Q49GNQYl8oEBWUFZgVlBWYFcQVmBWUFZgVlBWYFZQVmBWUFZlQjCOWTALcACg4QEApyXvc5BNcD+gPvA8sArQRZyckAyQS1yQD1TjcYtgNeBVUFVDpffUVf9gBYHzO5AI0MzHnMCqb1RohLNDESOSQ1REN+e994wf8Z0Cx3AXnXfD4lBW0FeMnPycYI3VcD+VgEBAQCAg4EBAQEBBVGDgMOBRVGBB9QBAQKil6LmZcdtyIZFyBzuzETAIzRGQMPGwDlcx4tHUZGMV81YEQ1RjEJz0sEClIdqxzgUElf2VxdeFsYBToGeWI9BAl4Bxl8LV/uQUgpCXWpCnAdyRzwzA/MCl/XHC08FwUAFgAXCg0ACA0wfqvfeEg7WCXJucm6CXPPAQIBAgACAgICAwPZ2gpuQZch2x8Ak5u1XyFtR85GCkEFm1+ZGCtaVXppOjta77wgCov7m1/vFlgXHEFiUVBFEjtRnDoKjwADAptfhxZhMDEmBT4/DhOPb/BsCn9k12AZAWA7MXwNUWAnRxApLGDBFBB5HgBzXGBbHw8MDWT1YCNgo2CLYMFgWWCfCASIcWm0AIcGD0gOHS1IYzsjSExVkQYWlACeATYPU3e4AFubriY1TyUFp6sGJwT5GnmT4c8DqmwrAbtQ0F1pWQbyrAHJGPvWFANTDj4NBx8FBQUFJAYFAxYKNRhaAYsCfQyXY68GGAkNBnSRDfe5ARI3dKMa+yUOAT62UPwEHgVTdQEHAE9jBEYAAxgDJnsDjUPHHEM618xXAQBtIlATAChKxQgC6QYpS3URKwmYAygEJ9IAhASsPBcIAPCvBHIhQm8ArxYSAlkDowC+j5OHAsG+yBcgXQA5lwB6GQBnAJkAxR0ANzod0BJOE7X08TgbzwceDoEfBQDwrwDyxCTmpADLVAp9mNsBCBkMJdMAy4BAt3gxASxBugz+6ScDIQQV6wH7AgAB+wKxAyEEGQMh6wH/AgACAQNnEhESAyGHsQMAuxMVFwB5dRN7uzsEJQMJCGYLvwAWpQcHBzAEPQSmE+szT7VxnQAhANEHoBPrM0+1cZ0AIQDRB9QDLQG4AEQT6zNPAF+dACEA0QfUfAMhBBUCR+sF6QXoBekF6AXpBegF6QXoBekF6AXpBegF6QXoBekF6AXpBegF6QXoBekF6AXpBegF6QXoBekF6AXpAyEEFQJHJwMhBBUCR+sDZwMhBBUCRwILsQD1+wB5oxN7uwJHOxPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB9QT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEH1AlxAkcJcwJJHtqhAlEMnQC+SQDwmUjKx2To3Nk9drTOS8SEa+D5crbG/LKigUvJti8HNv/M1nakgIxWeEFsLYS2U5z0SwNF7cbjxd2yIENpqZZJesPxq0YnQbOBW8SJn1MSYKRlIkW19s0K6uMmM3ENSCOiv1o/brTqmf2wucFx9GaXYEpTEDneQSgQLwnMQNBtWAikovHBeNbJMgOQ3QBjf16CT6tX513l57yghxvQskm5rCPh/B9UnFVgiBhlcL5h5LDHzZfysI69IvDGv/vso8efdWcaSDog7OEf8XM707TpT1aTxDcYPIUBAi4jvzMsDjbb2r0FoBUH/XiONSha8kjIeGspTPU/FAeFJHcRlDZXaB21ZFZLf5cEx/ouYyCsaUOAdOjZqU+iRnHIPDvdBNd0A/v4kyKUnmH8rKmD14yBN9PfClCISWmQfELxz4VU3/aO1azfFd7Z5PrOWfrNARBH3oLe69Gzb0BYtY0LKWjTTdiPKKoz7Q9kc6NOZCxph8Udsuw71ihPeb8u2pRC2LDHFOxOPAiC/vU21koIwRI4nP7DCe0tjoW5ctVeu1vjh7e4yk8JBOxkDbg22/Gu0Bz2nrDwcDxL7Hixh51gGP97jFMeepfcDBH+/7LXfRF9XM0gWVb/idlq8O7rlhOYxZNc26jgVhUeEktzLH7p1kSG1vNdosoG+emgnd5PdryhPllfMDVC3I3FfcYlqhWMwRJfD61sAu2xFm3EXWyi0ecgDYF68Cxt/ud4j9a3EYcVfnolHZcYLyVNQ3OhaJNAWw3gtJQN7cveJJDdydD/4wSEPcbWEEOZJiXQ9HXrLSCsIARCWWWIsXyvU8VUvIbOlHizjbmtKK6iPPLuSOlFktBC0v1Utt0/yMM784apQK0E8CrSyGyIzJYXHl90TSKz2WOpN+RPvCTDIzN6ocU4RNb10mFg8QziGOWAM7so5DAbhqUGkkP2vqvCLDHoF77hCWlabaWRcJQNMov3wXzpgORgLaDHYjV/5ZLfkI4MKX2ZCkdd6Frwer1kse/cWXDI69lPTcTqmq2uKGp2P3SIfmw7m9D1SviZ3WFUej8+emLDCQ5E3cV3KhqPePXdHpIP/s0qQ4XKXXF+A5UOP4ZIVvFG+SjHOrZX9Os1qB99bflVEMjI0QOQVDGo9XtFu0XRSURhQFz/8VXUjApvP6bw7b43Ff5KKl/c9pBh+CzbhPzK7GEQcMEHlyMDeOqbHfOKChqFy//rrH+bVcvDl7qTzS3PiGLB8YtjqnnsMPOOc2xeeJlK/IgEof9y5fbxMOAx1G838HY/5FsPJLv6Nr2soHuLae6T8Mfdde+StLIn5lpCNFt099bnd0PGgge4VDOJIqddqtYKx7xLZhBWhXAvKie1NpCjHZEWkThKXuqh6dcmeVQzWX8cvgpsYNmsvmLJ2UVEUktFiQlL5+1OIZZVXtAjPos6/pvb9Yx3wmeQW3e7Avm2daW1q1LkGzwqR9IEfrVXVfFVviIpS6XEKLIzKHwMk8M83vt2NWl5LjVKgKCzmq5KuxOrtW2c/WCzUhboYsVIkFCph7XbWhvz+Ly4byjXCJHQigh2dZGTegJxpp31gqrVdrM45JUSK35rXcJnFHkhlgGPDlg3Ky4Zqvqo1+fnkCRT9RQeUyS3byI6Siawv9jFeNQYGoHSosEbir69AlvLZM/xwXlnwd0ibPakQuHIxL7Rv+64LNxHMI6E+vwkwER7dIYoO2xe3GFqIKTRyaYHDRidw21y/ocPF7sSZmIYbqnQFPWvh4z4uqxtUqovURzRNhSYjdVTWAj9KdD+C+5dxei1JbtKP2XpNJeSlJXc5TGLJLs6OW77T5jXvb2BpZGrHtvckHCbCpetZ/RGEswnNZRQ4Ge4QX1PQsVCRDn3XcoJLJ3mDpD4rF35qB3h0KF0disAaiTpwRaEIS/ID0d9uRaOvfXsox071JOvJxvPr2cKarUTrIsCAqBv68Rlity7BJ/uosKNvZKkCfWNG5NMVGL9DRFgV6zDvhTOPWwAGgsDug04qK6gAdsxRlkCExl28WufXTGvXeJ62PWkIrAyjwsC/d8yDr9F2UUwL7qdB9DUkZQsrE4fXQx2VkRHcZ5i+cfxCLmmiexPQBMSoN1KsYcRYFN5L7v1dgqqH+2VF9rS6KokK3tOP481935JtTB/FXZWDBtRBdWv6h8TzNRWbCL6T4SFP96ss7pQmvQIwaRYSGi/HJBrmd/oMGncX1Xx9VngWNxfSCWNj3AS6O06DEIcIQZ3CTsL8sVoiWtmYoBIM8B+flTTHn7Mg5DN4RT3/nkHliwNt6IMgMjm4rgYMBuTOojMSWiz9AbnTzuITT32BPN8VC29+g2rP7WEV4gPCO8o2cNRbaCAIRChoadGE6Sk1Cte6eObxyCeKw4dcGDzYrlJBjI0YH7941YyJw3262SCQZz6ZdwZpzWF76N7h8HuTMaKlOfYnTddsnRMsmmPwztIMBTUeMH8VGz3LCt1wfT6RssUxtCdG4Pq3oQlbPIeiubr4n880ysN1yZfsrbnD90uvvUh1VrV+ddOROpDhILTHqtO02zuqB2EzTJNlQq2XnOsJYtSQ0MscNLBm3MAE7sA7mLMUaOyBUmK26J8+xjgoXVAZ7x6rMdGbFbTHv9GzS5kyk2kInUAb+S2aaXTSlu60SAFJC+49nYoL6aC5s6+QekJcIDa4SAwwi/iWal4pBCihicTomWmaCMWIM6pAPCo5o/MGnvxeAtp9cgr7WRCrDGPgRdnVoDAdl7rWAjN4V+QYF57HAr85vGPdqduQD42aSzZj35aaZ5iuXjPpnFM64tygePkaFJ2H+q61buLeUnEdsgyK0qnoeYgOu7ZepB4wT8bx6564XW3bFWis3ReNunbytRsVtSeNFvSMom3UDSuBaix+o78xxuCkIOjL3vqyMLfcvY8Y4Ma7eESKOmQR1oP3REglxGcwW0rvDFXZkLeJxDLWBo/EH6Z23LPCILaFv3+L+8cz+pPB8A3R0m463luIpxGEmC9Esd6vLmevsAY8PWJ9FstbVXfsRdy0Jwt1zvWlEzwzcgoubLsbyxkZax2jBI0F6UlyAUInlgp9yXiF91fhZ8YwVkEDEmTigH3A6iuWrKYEWoCSK/gIyZd8S7/udYOzMn7OHHrWAa/ElcHbBxarNUJIv3mta/7nLJzRlytrYwfodqtEeFA9Vn9t/qO2iMR5qccEHjjmrpHJT14kwAI6hKfvLoQOoTB4Guir4F6ip2S7lkmMwUsqEkNzmpFYqwpMPO8tM5JWxDy1AzWplj8Q7VEelXBNF82oCOKylGe8L87buNO9FodvVLMNyTATcVbpU0vxBW1pVsk0pWElP0yKch39ymRtp888pPTLcyYCn/7IF3z84lZfSTpvMTb8qnyjgout6x7R4CZD6hs6xMVvXV8lEmbuQaKO6YchpwhtyT+Zfw5EkTBp2AeQxkI/88DMLH+4C20juD5iPrbD4u0nl+ZNQn3wHGmIs9S/c2Qfu6pP/IBNMbx+rGS45ZBNIyiufHhVvgR+wRSSHNJgSbMeRRWLgqB4pek9Vzy3aGMN+M8OwdPisahrA04vmA6tfyzxHV2GVqShp5O7CxwW9aUvfuiXvoD1t7r3v8tB+Py4RuGPiHiFymnOkOfO9YEdXeSE3b6RlPXABE7onlGET5zEQ1kNpMB5oswHWaa4K4W5rg07ptgBLGGdAVpyNkrj/oXF4YTOZt8TpXKzWWPuK00ntqD+3vqlKHXZZd54VRD+QYodXm1x6xcMT4rNGaTCAqvFW/Yb3SA+DngAHi4wwXOojTMIkDPCRx49KyVlcime/lXi6JeAetO9Dp8C0phqx7Y/+rZAKFCQjQ06jdoIvw15k1MBdjZ099U3X3thFFbR3UYqyFgXCsQwHzCwdTW4oGY2YdxPPlt6w0dM24AG5hPdGVHMWoAAKvLKOnU8RKnM3cjm8tOgv7cnXgz10bK0cMFv156B8ouxbgg6uE+6kFFsfH6xcx+5LqBODDDMTtZUN07qQjzVOWvA4FgNVASJEuHSQt2LMKd6o52fOBH9fSJCNuYqPXCc4utapWyRXdo8+Vyx8rIwUYhi4eQhom0Ba2FrwoD+AqiwGG5SILAT5VONsJo1bl2lIXVX96muxjsBjT+ZDfgaZPV9+ISps+xYEra+4liAoxnxUPdwVZ9i6r08w4/bRN4P7anE2xZg0Zeyghv2cVHVn3SjxqqkUttM4d87kuiqhfacUczAPEXU0lNLerHzr////Cz9fA1JgrdFjDfXL558bVvJQa+Opij8JEOwvL4j05ywECQNFSVfnROXNadtas8zyazprxyqhmzoymPolSKBGC/70EifpB1AhBSKSAmGTwMih2EA2WzghzjHLogaNsnSAtKaDQ4i9lMHhwmFVO1m4dk9kSbmG3EHBkxEO4tQEemBgq9E4MwJQys+ygty72KCJqhz1SCU81oxib1K25i5I5lnF6KgZn2nhvsZKqSfliuI4Gf+s55MVI/i/6q65xf8kGRBZ8EErgt1PTDKuahbSBc+p9/z/nadMbf06/xuNl8+dMvRqt/ulzlv9W64NWOclbgABCzGYPIcSyJ9MBbvHMbRqx1nJJ7tk8f8U672s1NCr2PR0igtOp6+R6E5dDr4HOChkNXBOgTE9xfnawcG1opmnK2WQqq5CArbSy5lASeqsCK4tVARsSNA8sH24j2rnI3RokY8G95Q7GBZVsauKJ7ikz///fiwRYB4s3xXdL13VI9mh80kxtGqnTjXR25A7trOy7Q/jnLv6WKNDipS/60ntxrzQz05YrP9J8NUVvpKWtgMwlt6rd11B3UTuCrKhHto5eZ10efDAKFOVLqcGOw7AgWzYnA7W779PokomH9Go2y6c2RseNw0xc//70ILKzThoUdMMmHNWJiKyT//JIRqICOuqt4TmBhQ9d7WLmWMYESxGL8TlNPmqV1dRxwL3BNr6OqwCfpxCrXbkEqiTB9KTQ4NQPB2WxIY8pF2mZVdccey0phUZ8G8JPIsjP+Il+jhhRRwgXrUOZ8TRxVgPqAgJ/58O83q7O4ltBWchaQ+B4gYIEx/z5PZn/SXntZrupbxo92E5E9M7iWVKPS+/1T+4HA/8JqZ3rAjdih2EbZ1ABJTP11P5Fczwaoyj5eQgwEb72Zmv5AlHvkx/K2fYLeAaCtZvuSL07xtIng4tYhDbkvbSn7iauFBdxsbK1A5oahij+Pi+oWBNqBGwkkfZnN7LUn0Dnpplm5WDOAP1NNhtS4cl6eh/1iM50GVMlhuL958qqXdStPpIrGiXqjDS8QuvuspkK9/WDvHjxmG+G6NjCBu5BlLg1k0bSLl/MA7xQjrDNqunBQh/m1QhMAYNlCqG3K6HnLsffmLZNf6d9EB1JJHzJ6V6IPt32E3fQMcBRq7RiW9qVEeuzxV+l172Ww0n7OVdrMKYLJwcgWNfxqRjgMQ7XRjviURgn6MYfyf+Qayt9o8y4XRMkauok4PTOw/gk1h1jq1zFgSemK6StPmjpb1QwucQESo4wkvoDDTqYbTFtm53ffl0YEQvUW/UoKYGVBIkH6hjT8sduHZKQupeAJ2og1Ua94Tk9fMiDUIdkl135nxEKPlK2g54Mhq6RwkHn6ty7Fue9r5mxlrtwzlyCjXbCFvQ+RmD+obOm5SRbTep0E+dE8JF/HRf/irdoLPmUsxpSai1Y7Q7SbSjN3KvRFVjOygDA4TkZkc16rVRd96HNeomKO2TWBgvwz1iEFWQSg8AwwQvsP7XQhLfzZvbWsCdmhMDYl8MR9n9d+zj89ZSb0A/Rio/Bn8fXVAyNQmZzqOYHuODYQaicnPp59Sqz9sHpFL7+mdC+gqlKlIooyFZzoohLLtevb14YjTJ0hmiSUs6VhU0cgeXJow7ui+SIhWL64p6fWlvR4qxu8P8iG/ZKMU2jeaLhS4/Zz8XV+1yT4mJdLF23/ITacEtM55fo1iYvuzg2FF0fhew8FK44mYD4mHmqFXswAgBbMnCJscser/2ldcNkoLxe54eSHX1i1wEqLj6p0i5nXgVlF43NCXNfm+d2K6OvagwY07SgpJ6KREglAKv3dU0nrGF4I4DZAlsds0hC/GEihuUuBYEfPZXM3fYPvVnajqg/uabHY8iHvQElEMHFUToUYmSZ2OK9WrJf4gI94Bm94KR4FOBicsieOULsXkUAtrkykZfC5frNgXNvFCZ+ZRJNOLcmnY+a8NJ7yIhtTjMakNkOPxOUddKkeD9Svv+QoI59tcPAxGs8cU9gmp8vWzZpzbMZMdv6Vm0iyhzIZ+6kFVqZds/K/xGYwzl4czvkSiEPx+ri5VibSe5RY2A/iJdPl5QgXRDFWWZ8Y27xEi+gbP3q9QerDcbd9FaQDBIzptESGu+hXhATz4kkRTfBCg0UEdSnmMLsJiSkibKufvyHsds2iA4K/mlbxgUEsRrckCMNMAEFykjxCe0Oej+xecYMWayLHBTlcZmnkg+77kjhrDSebKHaqC1jUWV84GY8f/2ab3ncbyjSd1igXdcqSFHXoZwOkJi1MXfs8JRhgcifBik8IXRi3cGDyvowuyXqdVd2GkYZcGh1AkILWJBeULiX647UHJ7HYhgz6GJ6ETWrf7ONY6FkdMNUSTy7g57UaPkP2THr9kEUGsWfRK62bvnAoaW7PkcuOD+V8bmZ3h2r/QGP33fmY2/eIVhJ5MtuqBJSUnVuFVbnkJlDcZg5pRmUYpIY1vmHSzyN2Q8uvIu3o2asNoqDZisio/WFczGXGvctJFPRxM6gBmuoKGYKluKSLMluhcEMQhO8G8pHlAhTKf4hiOOx5KdEUYAp4taD6Gu0NWavPQXJNLXLMqn00llNfsMyl9+zL9elX09Wrqak4NKwGMjoQYKZTxGgpwVGi0ia2lZAHEY1U1eadAeMnO175L9vKYfQX9q+KxIIy2iauPHXomldDTiVJLGwr9p9YvNNhukiyFctaFCA51JnOyoyIm/mezdhSf2TyCSoQPrpeiQBX0hGLaznPj39b+BkIbQsblGckBIkDlkyo4e97BvNTmuC06Xid/lp8u+G/IBi5YHK8oyBh1+5Nm1kVDrz9mlcsM/VWYKmGZohRVm4X4iR+DrLiZHGA2EeeUpnzDp50Uz6FIVOSFEMFWu3GJV9SfrqyGpRK6jXEaQZ6CokHlRDHnGklbIZqk+4FYLvyyQJkoC/lhg/sUldokWFVsIemMFZFx00Von3hviPEeMduoEsoln+oqTFjFdt5Dm6NMLMkvBG1E0Lov4x08zCHMJnRGnp0dZH2+sShjZpHemRKphr0CZRUjECUUnrcX61A3w4L2qbH8f4RLJVuRZmULZuJSOkIw54ThCCgX9njpAfVQtfRvEMHJ3ErBvtRO77eS/q79i8GoNyy+1nlU421a6FVLGOnuBAsHtFyQrHfTmk6/E2gVTphlUBWXjOnJR96s7AoeJn4vBk5/UrOqu5/b7LEWulpK3rUP7+bwKb3eOraYqURiSXhBKcdV+C/A24oUwWy8g/k0lrwGYg2aUyO6cZLbpoJ8Qu5xpNcnhoajYk00222WrgRb7heISMTRzQ6G00Mtmj+6OO0j/Or6EEIn5Mcn4P6SWlAawE+XfLj06jKLv1NFzUoMPvvJKnlMKrwfGe5rYB1gFkEQXCu6CZlHU9CCXobZOoRv9qcyCn7jAu28TXabGMW3/Y8UpjnKwA0n/z8NJtJ+l4BAnTwwF5c5pG5pvVfQJZSpwokSvEzL4P9VXMOLl7otb8xeRZAn/cm9vVEhSzsGdPq/8mOHrM3+a00OShdmGDJfcdHMYgD8wmDh5qRHvn/yGqf0CdsFXcaGIad4FNe5A7X+dOXfUZeRE5pf50LAh3H9tg41oxewmHhS0aTdM6C4YABJIzYyKFJCN//UlHXn3bFVCiSHcXGSfuivF8smkshsGTKLwy5lM554Mvwy4vsZGgc0s1zKBgpsvGcGVEIIC5ILwl6tPaWvFfE4uvqgYQ3f8qD/6MQmuuuWYazEy6qUXDQYy9xWTwPo4k39zZo6+P6ikVuJe/A70SF0S0Hs5kgmEdUwqDCC2n/OK4hdYpyilNJv30naikyCgfloGbiK8q/9D/WTOmZEav5+o9xrlOfT/VaUJB/YGn0mKdMoWCSj0OMIzAWeXYNp9JdSAW1icwYNr3NB4P3OLAiWyt6ixqjVj7g3p9ArIz/5h+8ZxjGuwpC1ZFNalwOh8aCD0ebM8Jeiibf2JX9lcYZDvd955rtF4Wx3xonVvutMtx4nY/8K5UX8kmIWYQXFDT+jZ/34WOIe3A2bJx1POZXcLcxN1koBDbPE7xM1wURjqNZfj1GDCjscaUYMLPWB4EOPoghTbWdRxkXHrfW5G3bvFHnDHBzzF4p0HaO1lOdA7A0SdX1jYdqz8R9exgh9qvkEm0oCyLiGCuXf/8Aj/buOsUuMOqoxJIOJzweou4Ay238c6utFM7th7pxAOvXR2mnVCI+N/fgSLXv/3fBKkIHoz20oby2ljR0zqcpCLaZKPNQFBLT0UYKAFObvagVDlj3Sg9+whc2lDzwWAjiRsyyFZCIBp3Comloo9o8PfDOU0bb7kiZNoo9/9hki93RercLll9G8/8BLr5x2uMvxE01yd/3s6k7KpYc0EJiCoAwPsnKjJl9ZclUkddZd+rg9lnKFlyIxj7Ry/BtX7Jv1O6XDrVmZiBmzelqP+UnyQJd8SVd0CALiY3/ZtfhnvABFFHSwfQTgpZu4CGc+NuKWPrBS3fjJ/IqOdS0tKHDBnR7MyFC18pQr3Bq5lfGlyiPshOSBzjmT8KRHx7bvfsquxShMK9olY8FLpJC0wmjpxkZ8Ondc9LUyKlqRL/VOYcXohzYHxhAXM0IxjQBYC3+aUF+El8p2Ou3FLmc7KfPNmMtSAIWlyXCmWiAjIw1/XfkIXaxsj8NTQgjpIRGxVWxrb4SDYBdKi593owFBqkxGWrtclwUGjqBjqS64VVE3CLPpVoY4QJ9NpIGLljutANQDdIHnd6hJPhksvHqACEk2PMKaqUV7gp2HURhfRtnJysyqLcHUH9Nco97EqfCj64Z0RivcFeos9Pidi+9nSA7l6+o1URbj4PrluyqrjUwe0CW7u0Dr8+Di73roqyjK6Ny28WSfIcItYNNaqiCvOc5mZYGQ6PIIHvVqYyQEY65RxVUcX2b1Stga4M+0A9WuekEagaLn+KthHBg+NEEuL/EIop++PYlg5QKd3Ozd+B+5kIEX9xfT0bqQhGW0WBqji/tSA60/yIHiBBDVJr2csGgIQJPo0BJamvBTekbdkG46ZtOM0xnPprlHp/WDazyEOE8pl+gM35qMtLaUUZ5B8koWBMCsGhIOuBIx9Li8rJ0T4lfq6Sr0d4YHShAANg5qtXjkpb/H+DsSa/0aeIXzLE4bFt2p0se9AzO+NeRmnijL+7clCYeYNok+yEwnuRebBU7qpU74elMu2Wq2OwsqkT+Gk9qNLFzSDhdA/VOSq+GeIbC4/YYIA==';

// built: 2021-12-27T05:53:52.428Z
let r = decode_payload(PAYLOAD);
const STOP = read_member_set(r);
const VALID = read_member_set(r);
const IGNORED = read_member_set(r);
const MAPPED = read_mapped_table(r);
const COMBINING_MARKS = read_member_set(r);
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
		if (STOP.has(cp)) return;
		if (IGNORED.has(cp)) return [];
		// deviation: Leave the code point unchanged in the string.
		// valid: Leave the code point unchanged in the string.		
		if (VALID.has(cp)) return [cp];
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
					[tokens] = tokenized_idna(cps_decoded, EMOJI_PARSER, cp => VALID.has(cp) ? [cp] : []);
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
			if (COMBINING_MARKS.has(cps[0])) throw label_error(cps, `leading combining mark`);
			// [Validity] 6.) For Nontransitional Processing, each value must be either valid or deviation.
			// => satisfied by tokenized_idna()
			// [Validity] 7.) If CheckJoiners, the label must satisify the ContextJ rules
			// this also does ContextO
			/*CONTEXT*/
			try {
				validate_context(text);
			} catch (err) {
				throw label_error(cps, err.message);
			}
			/*~CONTEXT*/
			// [Validity] 8.) see below
		}
		return {tokens, cps, text};
	});
	// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
	// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
	
	return labels.map(x => String.fromCodePoint(...x.cps)).join('.');
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R💩affy.eth"
// this is much nicer than exposing the predicates
// [{m:[0x72], u:[0x52]},{e:[0x1F4A9],u:[0x1F4A9]},{t:[61,66,66]},{},{t:[65,74,68]}]
function ens_tokenize(name) {
	return tokenized_idna(explode_cp(name), EMOJI_PARSER, cp => {
		if (STOP.has(cp)) return {};
		if (VALID.has(cp)) return [cp]; // this gets merged into v
		if (IGNORED.has(cp)) return {i: cp};
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; 
		return {d: cp};
	})[0];
}

export { ens_normalize, ens_tokenize };
