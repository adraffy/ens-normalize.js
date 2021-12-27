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

function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
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

function escape_name_for_html(s, quoter) {
	// printable w/o:
	// html: 0x26 &, 0x3C <, 0x3E >
	// quote: 0x00-0x20 control, 0x7F DEL, whitespace, joiners
	if (!quoter) quoter = quote_cp;
	return s.replace(/(?:([\x00-\x20\x7F\xA0\u200C\u200D\s])|([^\x21-\x25\x27-\x3B\x3D\x3F-\x7E]))/gu, 
		(_, a, b) => a ? quoter(a.codePointAt(0)) : `&#${b.codePointAt(0)};`);
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

var PAYLOAD$3 = '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';

let r$3 = decode_payload(PAYLOAD$3);
const COMBINING_RANK = Array(1 + r$3()).fill().map(() => read_member_set(r$3));
const DECOMP = read_mapped_table(r$3);
const COMP_EXCLUSIONS = read_member_set(r$3);

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

function nfd$1(cps) {
	let ret = [];
	decomposer(cps, (_, cp) => ret.push(cp));
	return ret;
}

function nfc$1(cps) {
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

var PAYLOAD$2 = 'ACUAAQDpAIEAfgBLAFkAawBgADAAVQAmACMAIgAlACAAPQAXABMAFQAOAA0ADAATABIAEgAPABEACwAMAAwAFAAlAA4CiAD2AAMEfQRvDCAA6xbF2ewNxQcEpzEwUhdEIQ4MFPFdAQR+Xghu/sUJhTcAxgAjDIIT11i1UgSFFg5DORgJEggA8l1t/b8GgzAAwgAECncPWK5LBIPsVokBEm8EjVUKOSQHJQoSRAAkpU4lim0AaUYDM38ErACLsk0bwwE9Py5BYQFLAfUFWXmEMgEEQlUcDdxTNj3nMabMOtteTE7wrBKhLiUA8HAuAPZKIwPMS5cW4WkBPiA9AKFuMnGFBgKIGAkPEAICHRQQGRAAWAgAGCY2AV4+HA4+By4BCA4OI0IXAgIaFiELCt72BhR4WAC0AEQCQgLeyQ4dAQs6OQo9Pg4eH4lDGN5VrgAeDh4wDkUlAh4sAgwCAg8NFgAeVCqOBxMZTm4C7AM6BA5lDjQhjj4LAQ4HFn4GBg4dIwAeCQcuIxMRAhsmDoEeGY4WHRkODB6ufj0uEAQMHAAuEm4jBwAeqR0C304J7k4DDg6uIt4BHjAOFQGhni4hKxbeA94hzgAuCW5OEZ6O3gcfAAAQXn40JiAANBIYGBgYGgEVFANZAN4VACAODgPOB/4eVAgODI6l3g8evhVuKC4G3gr+3v7eAJ8xaoQEDxUHDgILBgBXBxchNAFdNxI3ACQGChYOFg4aCZ70BBMHIyzewwQWNDgJPA4LDhCFQRieVWsAGw0uRCASIgQOBxEYUyqCDxlMSDdZCwsPAgQDfAICBhIAFQgUDwIBEg0WERARCQ0xCAYMJwQEAwJ5TaJBAw0BJQEXLw45KRYW1gO0AAEAaklS1AUcGTMlHwAyERcXFxcA3gsKGBsKpb4PF7wVYBwPAPwSKf7c/twFvADjBN8+AQMAA34ADpgelQ9gBRwYYgLm2WYCr9PLGBAJzhANkwEBZU0AcmA8UgHw1AIsBJ8CuREAEAVbADUN4E45AeJxUvNSfwK0AOB9Bl1loWFBA3QYGBgYChoNDlwFIYoDANxjAOdXAMYA2gDfYwGgAzQB6QAzACJ4BL8PPhcAyYhoAKEBMQFUACzlXkPODDwAAzsRChOJRRjAVa4AW09gAAYaAdRQsm8MAndjAC4uCIcD9wTsCFObqROxVN4azu4OThg91H4Cu14+Hg4uAD5yA0j+3v7e/t7+3v7e/t7+3v7e/t7+3v7e/t4A0Pzs/t7+3gIADg4AhG8GAKAAMQFSRzw3tAIeFQABKyA1CkIDArZSNxYGADJxFeAM7kwEnod/ygAbEhkPHAIlEhkTHBEWIxlvEic5XmJrmgYHEHhnxxmTgt4PaXlhsZIQPA4SE81ODwW9wQY9BKBNMI86Q38/5DoAYUwBZXtFAdEsUJZzaW8HCL0B3wBh7A4qGWkkVCMJDh0QPD0eAx4lukgZTkBLLjdyAbYCkyAgWHm8HxsuFBMAGxt4pgHuCv3PAShNdLQIMAATfSQXFEtbDFHyBDQFaQqLAR0AZXkalBkSJQUxFESLGQmmT841T0vm4HcFCA8AdjhaLwBBStseAz1L7BFBDgEVA3YGnBk+BD3oAJoEwlILFppOCwIeDBUQzntD+oaxJbOqEsPmVoztmeEOgU272aOQMCbwOpB/Ypso4k/TTLW0oWpP3Rz3gHw2yY1UgZPtktnZk107pZPg3CQ+O2NJZ4RdQ8VrO8v8sA5Nf64eb7biK378+U434pbsbN5D/nUXJvQoZ2tsF7kCJBqxJCTNIptt2KVrMk9oCmdP0yza2mLjtAXAvD9RwvMgHNASOAHQHieInuWJb1575ohdCFscyN5HjENm6r3fmapvd12TrCubUm7XFYfHvmy8dSIQOESuJavaW0D8rbUXGUc7rPRuiWRnOFLlYcrqLc3LiwzjN7uzF6ECR7SY0Tzdx+FJN5Dl8dSD9VRuo2SKneiXQYjuXJ70nT50AuF9I7taX6vp5rEML9UbCTMpLStDd8XHbeVYsjSuXkuxcXDGzy11XOqM4/Ld+ZRABTvb0FzlY8mXbveszS4/glZhNu5eLJmy5AooQTWVutjvuWDrsDkUZ9am2TOeKMG8TLHRwjVBB4FhPtiujqXvesGvWwQ1w3s89y+jX47rIhp+El9c2QFM4BVQggIR28OeFU3V5TjwdLSSW8/9MAJ+qPuP74Iy+oDcIeIjgCJGHt52YnnwJV5+xKR+HjQws+fTAiOhcOW+zy609VzzQk+y0A7kdHdBBsXBB36UOFdzdYujG5PO1IXoFWrs3trl6gV4JKHvTsSvFdHz22LQv21L1uh45KVqrt+uUQyVd6ulDXkU/TOXxUk+HcujwWsIGjbyNKggFFDe5Mc4eHSKGezjtMlWeigB0nB6+8BrawOjtBF04xeKukf+o037M7ExZxCAGsVZ0PpTtc1TJlHhU+eUkh3LpBhTs2XCQewf98wydOE14KvF948SMOcIGmBFbIJR1V45meM46ACb1xWIaoJ3MkVdmkp7LuDsLQXzO742rKyrd/KspPEmjyviR3dNO/MNxJTes46EMlMdsAMMLPebHcs5hRcRuz1/3OWqWFHqsh7caP90rBA5z+0izaxZSEowxCpGcXJQmNX9ZRy7Wv2wppZZq5X96vy3Rhy6NkxfjqH4/xB5uK7Icux88zxeKS7HmRvYcD8R+lFRBO5I2hpXjDgvpLU+7LiZ7rsriL2IYSB5FoDZgc0aM7b51cp3qP5LO1LVPlSZunn1e/++/NlO4eEbUxhPePIEkeDKLV5SOXSS+SdvvpIbWH7fhP2kZRVCfvWrXrTny8dF2vD0/c17qfSxPu4hBzxzYL0X0HiW3j4APx7arPhNWGGOMWyuGGwuycrdUX3N1O3MCM+qWMORw+vbHSf7dxpmse8hGZvWaY9vtOvMRlFdhveoSnJLhb63k7kZxhLgSnbSVrw4SgaQmAVbn9aMlXJUuAW5/7DeZtB3AXYZJsC8u7TQ3U6MRQH3W0Y+TbKy23n6WDnjFbCNWCdxG69uYaQ65G91unS+/VBV5ogka0CGR7Pv1YajbSPKr+opmKCb8f/fHsNZ6yFhw4UYHSVjedw+2yeZ5IuZ6t35SPLGkb2zQC2XtoVv4vfHXPMH9GXD0mvawBsT2wVm/NdfNcvMGrXSpnK8FBBUUazjP+S4U5ffPk0rTU/FefFYW+Y2Ir95i4j0HghljDTPXjDwRIS9jeeG8RSNJV1X7TJVb/w2cACSCwugUvUcxGm9OQL9SDI=';

let r$2 = decode_payload(PAYLOAD$2);
const R_AL = read_member_set(r$2);
const L = read_member_set(r$2);
const AN = read_member_set(r$2);
const EN = read_member_set(r$2);
const ECTOB = read_member_set(r$2);
const NSM = read_member_set(r$2);

// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
// * The spec is ambiguious regarding when you can determine a domain name is bidi
// * According to IDNATestV2, this is calculated AFTER puny decoding
// https://unicode.org/reports/tr46/#Notation
// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN

function is_bidi_label(cps) {
	return cps.some(cp => R_AL.has(cp) || AN.has(cp));
}

function validate_bidi_label(cps) {
	if (cps.length == 0) return;
	// https://www.rfc-editor.org/rfc/rfc5893.txt
	// 1.) The first character must be a character with Bidi property L, R, 
	// or AL.  If it has the R or AL property, it is an RTL label; if it
	// has the L property, it is an LTR label.
	let last = cps.length - 1;
	if (R_AL.has(cps[0])) { // RTL 
		// 2.) In an RTL label, only characters with the Bidi properties R, AL,
		// AN, EN, ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => R_AL.has(cp) 
			|| AN.has(cp)
			|| EN.has(cp)
			|| ECTOB.has(cp) 
			|| NSM.has(cp))) throw new Error(`RTL: disallowed properties`);
		// 3. In an RTL label, the end of the label must be a character with
		// Bidi property R, AL, EN, or AN, followed by zero or more
		// characters with Bidi property NSM.
		while (NSM.has(cps[last])) last--;
		last = cps[last];
		if (!(R_AL.has(last) || EN.has(last) || AN.has(last))) throw new Error(`RTL: disallowed ending`);
		// 4. In an RTL label, if an EN is present, no AN may be present, and vice versa.
		let en = cps.some(cp => EN.has(cp));
		let an = cps.some(cp => AN.has(cp));
		if (en && an) throw new Error(`RTL: AN+EN`);
	} else if (L.has(cps[0])) { // LTR
		// 5. In an LTR label, only characters with the Bidi properties L, EN,
		// ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => L.has(cp) || EN.has(cp) || ECTOB.has(cp) || NSM.has(cp))) throw new Error(`LTR: disallowed properties`);
		// 6. end with L or EN .. 0+ NSM
		while (NSM.has(cps[last])) last--;
		last = cps[last];
		if (!L.has(last) && !EN.has(last)) throw new Error(`LTR: disallowed ending`);
	} else {
		throw new Error(`unknown direction`);
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

var PAYLOAD = 'ADsNlQQrD7UA3wHtAGABPADoAO4AegCyAEQAcgArAGYASgBvACwAcAAbAFQAHgA6ACEANwAWAE8AFgAlABoAOAAtADcAEgAeABkARgAJAB8ADwAWAAwAHQARABYAFwA4ADYAMwArADUAEQAtABAAGgSZBVUA5BHvAUFSEmccDzEA/gB9PGlOACh2AgMaAVowA98BmAFQezsCACBiADIAP84xBLvKANV0zVAbl0/exQIdAlKrA2hQAMsDsABjfC4qEpAAOABFAY0ABh4BZQE+uY0FkhESJtAZW9ABKUYHHQwyAg4XGxNaJAU7CAgTRQIOGEjLEgINKQE2GSgYCAkYSAhLMw+dKxgDkQAd3wN4NRcA7SAsYxgA2BjIVZjYJRoKKw4IGBgXCCkoTNYCwQCoAMgoKEAALw0ACGgoKAYKCAhIiAgAGBgICC4ZETUIWBgYeAAYCAiIiAcYGCgAGB8ACOgDSAnYOBLIIsgBCBgIAatoFwgZFsgDyCG4ABgJWDgRKwmYAygDJ8iiABgD6JgaBXg4RwB6Oh0AHZoH16XIDwioFVgwGCkIIwMtEj0SFhEBCx4BNBMhDgcVPAAIAB4mGIhVVdUQDgkRKmxDPv8AEQ8EDQMTDgkBAwcSEQJijCkC9wEPAQEXEwEWwAOe6wBUMwKNLKWoDwGmFUob+RITdgFqE4gGxB3dYxbU5L29aAtDKLgZS6sAKxkB51l9AQscVw/fI68/AWEJaQnhpxMEj3UTA8sH3cUGPwP/77OcjQBpew0EawkJMQeNACkASQKjCF0XCaoJykkBBSDdCMk3A78USQD3O3mxaQAPiyYAJQGFMbUAIwkAWABzCAErG+ceJhfnIx/6AoECoAK3ND84DAVFBWoFQwGEN6kJaQk+ID8JnwmgLClNBwgVUqqg00P8CTlmyqPmPAAfMQAqCvorX1sJZgCl5wApAEcBBJ68cTARAIoBFMkWyaoJAdrGBWkF7gLQrQLEvgEJCloqpHMUgRp7FZE2OxQAyTEnBR0RnQBJmdkdNy/JACkACQA7pysA/RVxn/FzSQANVwWlzXEWIwDMUQESk18AyzEnBR0RAoYE25nZHTcHkDnxAAkAKQs2FAWIVsGf8XNJAA1XBQBBehU9Bw4GC5k7ApOXQOELAK5dAXUArxsD5QCweQE/vxMX+SsAC5kFSwA2mzkO9tgfDNbPABQDoqIXCj0Cjq8ChuY/nAM2pwKEAAEt0xcA8PEAkwFPAjsA7IebCi8DCo6dYwBXAPAKLwAl4sfWGgpUAPlrCx0LIwshBeEAHQBFORuhGYcnTxTtAj8nFdEAEQ8AgQB1Q7WZBZ8Bzwqvs8MBKXGPAX0AExcJ5hkAbwMNBY+Z91e1BC0AHXkOlQCYjd8BhSs7A6kAdQXPAQMhiwV/Bd5F6eACiQBga8EAWgBlAGYAdQB4AH8AdAB/AHgAjQB6OYgdClRXUxoADFRhUxAATADbFAKwAtcC3AKdArYDA8UAFQDIAEXBVgSyBPMSTzI5FOk7ATdqGBwAQpkASpzT0AG/AaQCMQIuOAs4CAK3AqwAiQDbApA4IzQkAro4JzhABWfBAp4CpgKtAZIBoQK0Ars09TSEKDT5NJQkAGI1qzgMBUU0GzQyAzYNNlAENpU2VjZdNiI2+aI9YDsCiwKqArkBMAA+BWcFZr3IBXcFgEItVsdStDTtNMggCQpTC1bgV8Ole6FmbaIGGSED0xUz/4UBBTEEsVkCYWECgym5NQGdsbNDaQNTJQSRbxcA3wkGuU09MQkHNwJHawB5AW8tfwCRKycAowFXxQA1dyUBvdMDRTsvUQthAX1nBnMFAnMA/1clAzcPEwBXTwC5BwBrAIEAOcMGFQAB/SebjQ0AFy8ANwDBKVUFAd8B6RUZP5eGCUrhzhBtEGoPDE0XTHpIFRkCug+0C/MRIwzfKtlfqwf5A2EH+QNhA2EH+Qf5A2EH+QNhA2EDYQNhHBjwKOHOEG0PVgR7BZwFmQTkCJEmVxGPBzYI4FQbdCwcVQNTAQojM0kqO6EzGSVQTBpNEQgKNlBstX1GA1UxuVUDkLAD2TJdOXoPDB5/Eq4AOA+BKjXDTox6VXGuCllPvFgAAEUPABK0ABLvAEkWMQBQNQZGAEjsNOEAE08ATaQATdMATGYhAEpxBukAUGAAUJcAUFIAEj9JcE51Asw6tkAGCi8JoW/Jd1wGSxAlJ68RAQw9Ab8BRQ33S+IE+wZFBNMfhxkjD9eVpgivLecM9ybtLquAZCP/Ko0F90v+POcLV1FyD2MLbwntOm2BWAMrARcilQrnDUMIdxD9CtN1De8RTwdDA99JpACvBwsLGx0/Fb8mGmK2CxM5gQcFGwALmSa5EzN7BgXdGisGVwEzGwkA2S7xhbpaO1wmT2kGDQsvI9EUslAqDS9AwXhSGiUHHyWzAptDekqRUUAenSIAPEcNcC4dUYYH/zwPGVkLizyoRrVFGBHcPpc9UiJTTDYEP4ksOSeVCdkPjwzDfHwBYwkrCbsMexM7ESE3zwhDByM3ly4nHwgrRp9gpAUBqQP9E9sDFQVJCUsHHQO/HDcTOBUzBReBLuEC/TbfLr0CmVaKASEF1Q8vH+kQWkfqDvMIpQJvA40l9QA3FSsAISKlCE1tAGmP4lMPLtUI0Wp2I34DcRTxaxF9B5sOYQexHD0VyRzrcNJeFYYSKK25CWUBfwmjAWkE7QgTNWWMqiBLZ12LYhilIGtBSV4GAjsMbxWpRMeHggKVD3USJQE/AX0HQw0LAoER9xF1EJ8I9YYONb80AjovBFkhjSAbCjEDWWzYCzEnAw0CcwGtEmwDFjRHd/hntWDALhgHByMyz0FqIfsLnE/XDKYayxhMVDgZ7gfJA/0a/Sf0QWEGCQOtDR06VzP4BMcLcwiVCUkAUw6tIQfhGHQKe4zaATuVAcGjA2GbjQJ5mQZBBxUAcRWRBYPvACcCsQitAA8A2QNhAEMCtwenACMAj0sBRwMxOQEr7wKZA50IO9UBnzkB/TMEJc0MHwEBQW5UAsO7AoB0ZqwF52ICmAJTPwFXLwQPWFFbA7l76wDlAFUGHelRAR+1VNUk7U0B6Xk1ANEBBQAPPwcPSwHXAf13AMEBaQs7Cay9vwFX8zMAjQAfdQHhApMA5wA/AIn7AV0AVwVjAAMF3QJZUwEbOyI1YWsBxQMpAT0BFwCDBtWXr9MRKQR3B90CECUV6wLvOAe/CwMi6RPXQs8CvehfADIgAGkMFGBlaj0QO3xe4gIvVABQ7wBQTDSjNTpfUj8BsAGzMgMCt/kBbbQASQgCt/cCt7YCt7kCuuTWAtsCt+UCt9gZAFBLAFBIBlKbUowCt60CvEIATQDVAcsDoTFhLFYDA8leVjEvsgp2X09h9QywDd5E0jpTE+VgW2A8E9ItwRTLFdglYBlHGsYnDyXuVRMPDi3dZjoINjR/F8YASSlyg0tjkB46ClUc8VObVQItJQC7S6wzuQ22Gx9ESgVRdfdiNBYYAkKXAk36AmSLAmJMZVe5B2U3KgKiAQJoogJmEwKfjjglFQJmRQJmMAR4BIkDfx0Dfpw5EDmBITmMOi0DLQJsIwIyQDgUAm3RAm24+ZQJPXFPNQFxAOgA6wBUDweiDJcBCBXMABe/Anc5AnasSQJ5VU0CeMQnZuVFuEb9AnxJAnrSAn0TAnz6AUgKSIdtLgA1H0liSmUfIUrWAtELAtDWSzEDiFkDh/BEz5E8AvKrXQ0DA7hL2Ew3Lw3ZTVYETbkCi0kCiuLLJREnTXEPwQKOQQKOZkqhiwKO4wKOZoIAUb5TPwcUUt5UjwMClAUCkxYA8wAmVShVuVXaECwlKZ+QMut4cEVFQwKXqQLvvFgrsgBjLwKWmQKWhqYAs1m2WhOLVwBFApa/ApZYXE5c2wKZ1QKZblzUXREjApylOcw6pwKcIAKfpQKewpQAJxk7NBkCnfsCnpwAv0dhPmH5Ap7dAqB4AbMCnqkpAp5Yr2PSZDEvNQInuQImiAKhBQKgVuECpjkCpdgCqAkAhwKn/GiGaLsADVNqJmrbAqztAqy4Aq1xAq0MAlcnAlXmArHr4QMfWGyhArLHFwKy8B9s6m1tbVJpAyXXArZmRUlumgMpTwK4aAK5UR8CuTSBcEBw6wK9IwMtvAMyGwK+knIMAzN7Ar4kcyxzWQMCw9UCww5zjHRVP0906gM8sQcDPKQDPckCxYYCxlECxhqTAshzWwLITgLJWQLJOAJkpwLd3HiDa3i4eS9L2gMYrWcMAmH+Gf2VLnsVXpxexRsCz3UCz3Y5VV3c/R2pANC3As99ATP0A04cflUPAtwxAtuUAtJZA1JmA1NpAQsDVZaAk0kK1SD3ak9/CYLYg5cC2tEC2eiEGoRTp0YDhq8AOQNkGIZ7YwADAF8C328C3sJ9gQLiOe0eAfM6MQH0pQHy3JEC6/0C6XqDCQLrAwLq7gEDUQHDAQLukwLrppa0lw0C7kkDheqYg3DqcasC8w0AcwOOIJmdAvcdA5F4A5KRAveiAvnjAvhwmiaatcVBmygDnY0C/wQBJQBDnyYHn70DBZcDpnQDpuMA288DBnShkqIPEwMMUwFXASkCvwNPAKUEicNxDwDFBHXJG5UciwCNFQAhpUcEpxchiQFtAzErAIz55Q8A5q0BEambA29hA4MATQvHwgRfrc8MALUFH8kM9ytLTAsdJjvjOzZGNt020jZPNkI2+TbmNlM2LjcZNyIFdlZfdR9fygCW0wVAAJBaJ5vHOzRgQB+63Q49GNQYl8oEBWUFZgVlBWYFcQVmBWUFZgVlBWYFZQVmBWUFZlQjCOWTALcACg4QEApyXvc5BNcD+gPvA8sArQRZyckAyQS1yQD1TjcYtgNeBVUFVDpffUVf9gBYHzO5AI0MzHnMCqb1RohLNDESOSQ1REN+e994wf8Z0Cx3AXnXfD4lBW0FeMnPycYI3VcD+VgEBAQCAg4EBAQEBBVGDgMOBRVGBB9QBAQKil6LmZcdtyIZFyBzuzETAIzRGQMPGwDlcx4tHUZGMV81YEQ1RjEJz0sEClIdqxzgUElf2VxdeFsYBToGeWI9BAl4Bxl8LV/uQUgpCXWpCnAdyRzwzA/MCl/XHC08FwUAFgAXCg0ACA0wfqvfeEg7WCXJucm6CXPPAQIBAgACAgICAwPZ2gpuQZch2x8Ak5u1XyFtR85GCkEFm1+ZGCtaVXppOjta77wgCov7m1/vFlgXHEFiUVBFEjtRnDoKjwADAptfhxZhMDEmBT4/DhOPb/BsCn9k12AZAWA7MXwNUWAnRxApLGDBFBB5HgBzXGBbHw8MDWT1YCNgo2CLYMFgWWCfCASIcWm0AIcGD0gOHS1IYzsjSExVkQYWlACeATYPU3e4AFubriY1TyUFp6sGJwT5GnmT4c8DqmwrAbtQ0F1pWQbyrAHJGPvWFANTDj4NBx8FBQUFJAYFAxYKNRhaAYsCfQyXY68GGAkNBnSRDfe5ARI3dKMa+yUOAT62UPwEHgVTdQEHAE9jBEYAAxgDJnsDjUPHHEM618xXAQBtIlATAChKxQgC6QYpS3URKwmYAygEJ9IAhASsPBcIAPCvBHIhQm8ArxYSAlkDowC+j5OHAsG+yBggLAA5lwB6GQBnAJkAxR0ANzod0BJOE7X08TgbzwceDoEfBQDwrwDyxCTmpADLVAp9mNsBCBkMJdMAy4BAt3gxASxBugz+6ScDNQQV/wH7AgAB+wKxAzUEGQM1/wH/AgACAQN7EhESAzWHxQMAuxMVFwB5dRN7u08EJQMJCGYLvwAWpQcHBzAEPQSmE+szT7VxnQAhANEHoBPrM0+1cZ0AIQDRB9QDLQG4AEQT6zNPAF+dACEA0QfUfAM1BBUCW/8F6QXoBekF6AXpBegF6QXoBekF6AXpBegF6QXoBekF6AXpBegF6QXoBekF6AXpBegF6QXoBekF6AXpAzUEFQJbJwM1BBUCW/8DewM1BBUCWwILxQD1+wB5oxN7uwJbTxPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB9QT6zNPAF+dACEA0QegE+szTwBfnQAhANEHoBPrM08AX50AIQDRB6AT6zNPAF+dACEA0QegE+szTwBfnQAhANEH1AmFAlsJhwJdHtqhAlEMnQC+SQDwykjKx2To3Nk9drTOS8SEa+D5exgc6OLoUwOoVneeG0TVDzhWLH72mv+7Y++QKdpJPj5fy0BSSEP+MsdAMQWqKohmLa5zZBRjFP0BzVvhf7p1kdMCwN1RKikWrXVzQq/taDsjRFnT4W9RMsod2yH1IUqUbyVMzmuwlYcdpMllDxgY0GnGx+lV20s8FsKw69ldIv9dYRVF++MUWxQd90bhAgcBH3zAd3cbyVAINQMxnOsTcW6+g/L8Ng1h/jfe5UR3sgV5KkdMa5iBSYv3dhuBw4bbVmsk0PhN1O0WtTDC4u6Y+kkK+/hRFGLHqhCCwrpSUwzU0nuoDcnE3gffZH6ifUaFla/j1m8zx49GSDjUSCLxwGdnqCXPix077HAZINK2KVMjEU2UtMNkRDTj8SrWKH82KIHrcJfOjAUab0WyUPo1jnHw8WL0k1UHop74miT3+kOId3Ew7FrEoJqNWxRIz4dtkdceyd5oQOHNRBgmH5ldPZdgbwuo4Fr6IYNdeoEg6FoJgpTLRyes/ue/cEy0zzdQHdocuQNqsnrgI7g4aljli0vjv67/99q1Imh1WDN5HTP9a3fXQDmlTH4W9jiIfVnh95W0sRO84gRIWbJhQdhilvybNlMj/7LTcFIiZThfcwVg+ma5jEXs/3JuF9F9AqIS/VdqsaPWzxvWNQqBzCFNHJuKqccVm339XdhhEvUlWWd8iLQ0bS2TZpnjD3za23fjs4Qwf0f9CQF/8oStsfstw+yZUKJAe+lP8V5EzoJVzB8rAmni3RMaFg0l+WMxedqdhdU+NUW6da77b6aB0TBEZh+lme9/0dzCnHZ79Wy1ZytcrHRVdJVJ9UKxFyBR4ZRqOg7bwRpxxTt/Fi3+/ZQ2Uoa9n7ONiqeTRWAlMpxUZ/DXfiI+zOG2Vrmsg5CfWpX5yLb6uFU30ZzFx/x1dlgNT4vpw+HfHZRxAj/F33U2ig0jwVWgRL/rWI1DXTmz922Wi5Nn4iHnBAikpGqND1XsrawEsgERMNCRd0TTZ4YQQMO9AkFJjd2cHhiwyDLv3s8Bu1ym9cv2euKO5oAlFYwUnnzqCEK8cfNhISuHBPPdxqoeqLidrY+GUq0rdqa1XNe0FR2jrARLC9TLgDFj6A10VtbonQ/rz5A3x/1z8ZF/h95pXzVh9YfvQXIXz1Iu4DTagOSRNu3IJoWCYiW3kpNYrc1VJyGFf5b++yGoQZ4w33nS3rgEEvTfA//ERK3sFdrlgKrDSYC8BS1qT+yFi2I/Mhr/BrzwGyfG5+WVuNp5kGHRyi5S6E/EinysLYeFvlt9X26bQglxd5TxF9LeuK1a080XokaC++WDU0xxFm0+JElKLQwuwWdUfahuYoPzExcq4zfKChRnOCg1fdVVw4hQU1jEpGCzt5RvYcQArsw1msnp/whOXc1yL25NN71csrcp8VyDvIwIZYSDroZ1CwnSunnOMEFxdLCuLsj/o1bNPOfEziYT9MPzPLcVCCDxRxkpQfMvLODOJI/TIFuvoqr/dfeIIYVolLYUcvIk+7J0+VuUomk67fhj1hBurrKwBI/p3iAD4dlxAt3a2Kvew8MmQjT6HZjS98rF0trl+NTN4O/Iqb6ATsim7Tu1wIupHqV8J+lDooAMBIS622s8b+xbYzixLgE7wckTcFP+6pOSWt7qscvzAAoPiLk4dGrNOSPNT/CJxJHxLOaphsKrV7xkuLZRrq7AChJzF70PX8v2qX5cHSpRbRhTeQ1l89cxiTijd6nvkWQck0mWwUCL0VegQ/QX58bZ3OxyfWERERj+OizzPtquSCixL8u/dZBv0cHgOJu+ec0LKJJ9F77vfy31hfcWaMDY9xEjZJNMjJxhnw0Zhv4hmaHOFTWjxj9jIMJDLnRSAbcCyGsNV6th0rAl8BUzMF7T1bhS1AoDoW6jcVgV+Q6VY9L7HDKczalE2hKSVwO7pafGj1+6p669o/OIpndhaO1jagy2q1Ok5Uevnw5StwmZ/3hlumErlUaWQI+BETgOvLvRecGA9aR04yeuc1fRcAt3z+Lutgm0y1Ld0FhtDvyNHIlhOOqRg61kN3qMURqzWmRwgpt5o9GEA2mXXyVzcqCKy/YZkxz/NfN/q2clqyrKdIEtzKwQMPw3HFvIadN2XJWRlEH+nZC32+xidDMFHBr+lfY8+lSlzDkHdcpefzvwEKb45jkXAcK4IcOzAvE0Tj9UTLvGwmhwfBdnFmvaR09nm3pZBj0PykpMpUfxXub2gdH+W5VXckhVhruxzwEI0g1K4w8uw6Oae4V1Gc/lbQ35l9v0Z/lmlDyh4TuCEwxAAAxnzRp4lFSxz16iHRUXUlU4aOwctW9km1I64NlCQph5/BbzIBD6ZzLS56i91eX4qe06EZNiN2ZbkMObQiRbYjzbz57cbL/mBoV5CjsfbtcF1kszj9HMdXoypK+FQX2aSShch05CIbsauHeoonwQxn1oMm1VKbJujKJH9KZyWnTfDuDm0Ga9/vRXoOEdGVOHPoUK4tWCe8p/qn2iWIH5UYIyvMzWnuGgq0+zfhN1EHv2eMmfT7X7o04WVMQFk4vmxmpF2qJjxxRx52eUBafQvP33j3Rv9nn+TmJX82NIJGm3W9OVdudi7eR1MaVL4121zIeYX4mYZIljU1gaP40zjxS7PIu3KdNqOJ424z3XvcfR1DSjykT9izHz3KhEGVPHAt4VskDaNPcDLskcsMcJFGi8MIbz9NEgMqpz4VeuwaZrqyubWb8M1vrvcGtossK49pRm7/oGWdpv4P/pA+9mvrzBiTB/bj5weTqHmPyMis27wvxteWycntSmdZUukzQ9LwnABR0AQfisd+efi1r3hm4oR61ChOaMNR532q+o8f7R147KB97HmMcmPKNsRcCZvEz8gVXgWqiZTPHOQ11Rqiu7jbAWNezIvwGZNHehmTUxpTPGLkN2xbEiGEUfl1nzQW4pRTSh9LYrHHnivStstZuSbYqZM64CdOvmVCfTpiL/bxvJb4ASOAV7Dae9coC5jnRrkA+i0GeHJkAUxGEgg9nDxmJTtReMUnhz/j9GRhnn35H7EdBJ1F1haUh+RqdF9LO7dxqrEQrG0CjieyxsqmO7Z9NkYbGTCLdPaq1CusLAiFt1kmBGQWxlJ23kmKw8AlW04Tzc9wtc1i5ksDHvepIUipPDrNvUmZxGBeZjpEPb8clctfHpIgMNLJiSrjDvzZuAAZfzlJqyker55/0LnUAZTbB8oDY/DM9BJtRazJz1lo8wi5SQH2MAHSBuZovCDmJxZSrCngo06wc8TsQL1grkkV4jWWYgUGUsggwnHTMYM73gOSiwvT4sLBSsm8lAYdiw8NTa6qWn+dwa7j+qvic4/kBF8Bft8F0Pdb6mn6xKZ9zI7GEpW2ISKA3XUTn/t6bBHui4YvFd93pQcxDDUUh0TJ9Gq7a4E7+SoPE6HzNZAXKIUYp1uMzKK7HtRVlR1Ga5f0uv+HCLq0G+fOm5ef9XLZUx1SkCWHPVcWXZxEyGur7AkNEALwSxKpvYI8/Jocldl9Bbyc+rseFPXIJgPYQSgPsuWTJOQzpdvrnU/9uQIH6JJQluSKoAOrHo34fCgchDPEctueD7KYEkEupzYErkx7ey+WkIbvKEjHW2IeQanOrXd4SkoYS9LDHuCURMBbsfxN0kiAUVNzJ27c+hwlmrC51kxviQ/1xp5IRGtmy8BLrwOdIymIxjWHg39vTQ5DTt0JPLiaEGrve6m+2l8qE4wj6KF1xVCpEbWOBqxMYERZfNBCV/QVTaJvLJYoR4UM6Gw3xMimD+wC2pbMj0I6tH/FNgHtoRabaZzubYJQAZB37rdSp1itwBQAgPkjew/dgtmPw0R0EifV476OUbEcXqAFe/MRzmrnbB+05maiC8ogoCX8dl7+u7QlBvcqb/j+eQ0VxcuLE4sM52/W48xuqKWzFkzm2e7G32vFq7HCP1EV/SwOY4aHf7+P20buohTN6xZdK20p+sGv2aqItSqzmcRFSHYDqgqyf2pC14iLOCBVbSCBF2ttP8Basaq0vltn2nGZ6Q4og9C0dHk0rePbcJfAPcud9+KMs/wKtLejdEu/hbIE7154t+1T1gLiOu361zNlQOG5R35Vn/ni/buo7miH0QUXeX17+JwaUd/p5N+X9VMfeM4XKTtuBHwi7uZ9iahu17AVee8WTIxAdVG//aSTH8dsiKrhIZOmmcxNGcKgaKr/l7n9z/4YUJ1nsMiR5okpDxfO////AiOkupZU9xBJzLOSJnFcfeT2or4jvqKGU6ZD2T8G1yvryQQ/8uic7rdpQfZFF04C6GaKJrhhOO/2C/qHe5lsERjIUCsnzrCWLjFLb8WUJZ/MRTm/LezlrsRdFawfJJuuUU4sSYWc2PH++Fbl/BXN/2t15wbfz/E5G75guQ1+HgIqGLZcVAEm7eDpuKUA8zGK+MnIDFapWjb3fs4hn/BMSftg56WQNRzTpt6ezONa93qs5q6Qzk3qQ2ibgl/XJb6B79c/Y2b0WDHBhWY3F2GBtFblju/ELvDIe9Kt83swqsU3GNmt+1tHnWVUfec2R7MoXrx+hKOvVGSCSkiMUsOy7LMaP1OLDT30VIhxpzv7AxQhCe9Y6hZ0bcaE63GJGdN3yfG+auSlGvwpQwLkcJvRDWNrPVwxZAKRSsL8oBqbpNNG9XMi50MIC5WNj8GjgbHOptRNlg6eeT1K9Rgi4Vfo6v3AKf//fP3PNX1Qy/YMWzujV5I1TC+WmY3lvjGnKAq1IQR6PbSR0NH6S3mHRZC/6xm1sV4VTYCalecFXLms+ALNfGgtXbKw+ymz3PmmWlI6uni1wKtmXi0UU42VL+7RucjMt1WSnWH3r40e+YdEFk3CgZ6wvzS7dPn5gf/7z36XrJ8yjE5AOELhfoHUPuenGSvzycTEdGGa/zr9oKZ+0t30h5kxWsJu25UJwk7kG0efcVroWVBtshGHhdCxkbzoBJo32MV+Ke6NFze7k+w/t3OZ3IQdo8mnd2fZBEOFuS8ben0JoLmCxKn5rqgs2WmXWSUC+G4ecBEJOEtEHFw7aAxc2S+0+zOyGW/AzvNVYHGjNS1Ap6aArMw3QA5ultmrfPMhX+hI4RUnA7NoqqR+M4hfVrlWKcnciKxgBK6hkzC/10lDm9cFnFE6SisXgaiJA8X3enpWU279uio9+TzIoVVc2ZoKbr7bQnJaQdxWo2uhc1AEIYTwQU0Vi6ZTNQeKLJCU6IuYS3HzeASJ74GCZv3FLNJTtruc1l2wnQpEPC13fFWFYlMb84Cz/Qo6qXnOms7up1dwWX0NJJpiJxt3skvdEtgRo7TKCR+op13vJh1E0wzgYWTtjfAKlqKK66hLbKhgH2sywwOemrV6TPXxqOYSJ5r9+K7NhD2gRsh6wSf/F8TL1JHUeI8d4FVknzxV3g66M8ql3Qb1R2t9WL10z/0FVaoyYVokyp4DJZy1u8vBI/gAhMYg0BEburmqDWP56zvrn0ij9DIJFBmrTnvVnemPFoaa9gXJ0FZpxfgVNyMwGaUa9VjRPBNSFgy1Xeyc39IArptrtXRkit0AEQPcFxpF2p2dylk2e2t9bjYqKAkCnpH+ieQPyuG9opMD5rueacliKmWMe2TtPvmTprLfsSpvgZRM2ck9kHJ4ThUD03SvckV6CFjAQ/rSIv/4cxqtonpEygKTAGo6gxSMBOWu8MDmLc+g0wHXz4c/Uk3uciGLpW1hKeubAWqepGXdGXlcFlCOT4bWrLvKZwJcmnJbLxjeKh7msvGw7Yx/P8H+JD3DggzlNhQn0kzsviLXXf018z1ysMK+JyyzJG/xhnpNi+aFyjoRRNvJ4uUDBfMn7aPya1lzsHeVCs4IKf3eQ1J63Ioqj0nMZtGh/6Jtkl1UtFEhaPCUJMHX2ycg1N6pBaD+cDwaDRURN50j4j5Lf9Hop/NIVso5ceCEYY2pEzsSd1j55ywD+abh50yZqZj4pnvwXCJM97ixj5AoMYiducHkViiv4KtFrlnF4rsws6N69ugBmnTuV0wAp6Ro/MTpuzOZbArMsm8+up+mBiFVhN6j9160oU99ORb+u0pGY5h8IYFFPaEQzlRrwfbTaEoozmfPCIV14pX+9LrFvisPydCDFq1Ff6hZreZrstFTDVZFohaBHbZJwH4VBMRHssYmmHMNN+prOuIEnV5FdlXBdKyWWAcq4Z32d6GgEpJkgKnrah9DKcnzcJfMoHMeikc0+jhbv/4IDBtqWMmyHvcUJ30IXAG0d0SeFajOvoU9Tlo0jthcpaAnnomTE5d3ttNj4ah6afLrpww0chcQdnkn2nohL7BjLiK4vZ3BkE3qjCB7ZcqUUtbTDU7bKckZaErQljHTA/hTRA+BU86llI5YwCMle+n3JXIqr9jCJIw5L9sYXpDNnsvuLE/X1TJ8zsmuoa7161CXAllsrzizOPidTnZrUiHy9sXY8tiz7/DI4a/9OEZxxzJWTJcUjZXJffiddRGaha2XngoKPiifwXZp6YdAyrrkEXYKcTHpLD2wNlWWl6EYF+JK6Mez2GnFb5omfA08vL7EJF+SCa0E4/+ymofBBJi8VqDak0NmIS0nHCbzdaq0NZfRNYnYPoiYVIIT8mLOAG5PX124kemBsR2F/8qTU8YI+JM3aer7p28iVksK2OGBM6yJs8EH/UFvN0HfCOtjF9lwIvhhBBwtuk/IWHLx4G4YcoktNUdkd2JV6Fw/J+JKJRY65eQ5HYsQkod/tZLXgnQE9wtlFAkzfXI6hpWjSMB24z9yBjlgZNVL/8eIkVeTQFDFywsswjGstpSXGOjc6qnnCBdhNythcpnJKB4s2ngX/U9pAHmfN+BIQf4Y7PFD+jM0DZhR1oaMH7AuhGuj91iW+czP7/BX0BPoiELGrYe+MWbZe2nerQHZA7A3WAqvbsUtpieMx2x9THzPjCdDkDu+AwYsBlzQwoWjwZLYiMsFcazEXk7zvejUM/1HSUWnCcfJqYLaNTA0LFXJfKLc1HUdQM3YI1x/vfQVZmvzBFI/1K+3PhJ+SCnRc2ugAZ1bW4Q5E2hT08U5q+pBSp8hNgDAOxaRywTwZCBX+SiNW+4DJLQV15JeYY8a5IJQazAlwbFLmuiHwGcN9vWMPoNCF/CTiX1sMwUHcP1G9QigNlSjpfNVZ5cFL5FwwFWoQ912b+uh5cpCy2WC75f+og5cmbOYJX0NTykOVTFVsl99BST+HsKfKMYXXG9ugQX0NTXAEgkMZoutzlpOcXDXFBZeely7wq20SHf4fyRTPuJkPVyC9O+avOixLf38kwy/VLfwlscFF2xu3IqoxNC/xm5FX17Wdw7hlk3B40EmJ/G4YeFNNbyNvc/OKeIebkPR1nVeXtDcLXgyZDt6bTTAmHRJC4BCWSsBnGA1/cSX8cdScnz0BzN5mRtNMXsXQD+wcZBq61AtNtUH/vTdC4hE2vFM64zH2Nz3GBNWu1nvgq8Ehz0jlaaelKkKB0oUOpMjFrJcXm5+UT7QuAiZiIMAL/y4mk4gErYvbV/EiSI1ZsVwIQxEc7iL9pDaaL77g6iKbotvVYFLieOfV/tVQoriWe3pHHXTh8zKuhBxy0uZG5y6UJOwjQw0+OUnFGuru33m7+Kyzz6LEAYRv4mMj4Rs5Z9IKJevcjL0I9FgZMZsCWZE8ly53e97DB2cBbGvwfVjU7PDCDJxWG7epC/MCCjpoVhACgXjeT4PRBKrH87MVft2ZdTWDqw8KRzqgkiVxapDIQmnSDpsc52R6+a0jQkDrBloaoB9BC93HCwqvpwO+zDxL6nhk5oIBL+y+GRUcSb4v8vlyE5CLawTQgi1RrJ7wVOvSIO96yN7ooiZl+m+9dmtyJY7895TZC60CAbenQFYILHu/B598zAbrtC0yLPR8FIhcHpjGmdzjNsaRQb3MvsGne2rXRrgHQTCD/KAaxIQ1oARDPYmy33mvJWOQlUqg0BgCi9fb/qFCDFtflerF10yysEXFYUydt6yMjHA/1tHBEvJc3i92DmK4fQA+VLwlNLgczj6jquQDzbcIhs8aY4EKlIANgjgsmwGZSadXhY0vSep7LmbMnr/OK+IHGx6jQAuUdnVTy7kfyX2S7v1N15A7+Bi3lDoORJE7oMwPtNRKaVCoVZMUsIwU2GTd/mQcRb3yDhS0mStuXLSMtbQCTwTcYdEzm+rd2fdsuSX0L3tsCXVZ+s1aSShfGjxrSRoBjIvK5fw1UmR5yBJTzJVWSWpqPpUwzofAa0G/jAgehcIqoBI4wTc1UzXtPxcTBF0K0IaBeYWpOPZW6Dwo1JIvXeo4fXfS0gJCXfabZ4M3HYSKWawAlFvr8G8XqxW8Akr/y/TfhhmWJ79qyGBRI1fox4x6EoEsuLPvcDnSxrVuicDorjxhXUB6RAtGDanWeBuW73YRhVWVGv8b1nhPnZNp7Fy6Sdiaa6Kbz8X2YpiOmkVWdYoAI6snScFNOJXaU2jSIhgyWUNh/wS7oGmoE4GU28adbpRcOo9b8Nacc7a817ii0o2A/svFVmXjzWvV8f+sxOI+Cx/H4JMjszxrN5XXyQ4lzgzTFytpenF2IjccPXiDm5W+ABnTpVZmHGB3JvAtCfwVjJCduoWE8ZCJqHKWSi95Cm2xfk0XFKNCb85kgsVR0+/8qNtktpNNwofb1i96DLPV7rxj9v03aVoK8pqH9YAJhrrjwwtf2TyA1wYkp6ajLhjBYGuiuVBfo5sjeRW5IwyaQJwSLsf6ZwmyO9Ai3tIiTBrjX3n3WQh9w0bFxXOUHQ8Muo+qCvGaP26qi+PSSrJKHpDM65Rt1hLH9aFS8HcBCfWwj0VMeWA1yxqQwn5+kym6Ndgsm41E2bRo/7NQyrpqHgnl5IoG6SEGoLamrXQDKb1INDNDo946IHSqh5fpNdBfAjU/tsyC310OpllOU/WyKLFOa8Nk02mR6ho8CyQbRrq3hUhrwv5x11kioemluO51fL5DXXbY6UY5oF/zPDi3ownYJHUx/DE32XiLkj8zU6s+gOhx0l/gFIRiLc+VMv8dJaDmONoFMhM1i9SwAajcTcmpZF1sbMQNDr6MGbJ4vjsIOIATTy6zyrLXNOCpy2okCBpEBDQdJHouYjdRlI1DF7HSNgfAAfITEK7QmVOR3NBGfmiYR/E937nSFYQeMtv4Uopj7Aa0cMnRB078G8W4lnvgEq2Hg96GdfG8TyNTMuS/S+QbVQKqJQhPAiZt4R2r0TNVmyMXIyAP0IU+NQoKIdgmNprQR5ZDXp3+g2/3UwYP5ftIZu237Ujw77YagIK/J2YmzD2q0yqtfiFcFHX0pD+jKK5jyIklGuI4mifZRbKDflFOGWJEbVlyD4HVV0ZFQ/36hxYR5sWBVCVP2SNcC/DAheSIrLGUKREuY7xDgU0JLo4dHSXKfgroiVM52NDlVz/30e+FFHfVQFC6/lHA1567Iiz4qIXCw1ox3tIk4di4IJhhSmgZxBWF7tvCnS08i3GcNDH2ANruIbA==';

// this is a polyfill for normalized forms
// it exists because the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
// but lib-nf.js is approx 13KB as of 20211221

function norm(form, cps) {
	return explode_cp(String.fromCodePoint(...cps).normalize(form));
}

function nfc(cps) { return norm('NFC', cps); }
function nfd(cps) { return norm('NFD', cps); }

const BUILT = '2021-12-27T04:32:24.044Z';
const UNICODE = '14.0.0';
const VERSION = '1.3.6';
const IDNA = 'adraffy';
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
	return tokens.flatMap(({e, v}) => e ?? nfc$1(v));
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
		if (STOP.has(cp)) return {};
		if (VALID.has(cp)) return [cp]; // this gets merged into v
		if (IGNORED.has(cp)) return {i: cp};
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; 
		return {d: cp};
	})[0];
}

export { BUILT, IDNA, UNICODE, VERSION, compare_arrays, ens_normalize, ens_tokenize, escape_name_for_html, escape_unicode, nfc$1 as nfc, nfc as nfc0, nfd$1 as nfd, nfd as nfd0, puny_decode, quote_cp, tokenized_idna };
