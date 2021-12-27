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

// this is a polyfill for normalized forms
// it exists because the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
// but lib-nf.js is approx 13KB as of 20211221

function norm(form, cps) {
	return explode_cp(String.fromCodePoint(...cps).normalize(form));
}

function nfc(cps) { return norm('NFC', cps); }

var PAYLOAD$2 = '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';

let r$2 = decode_payload(PAYLOAD$2);
const R_AL = read_member_set(r$2);
const L = read_member_set(r$2);
const AN = read_member_set(r$2);
const EN = read_member_set(r$2);
const ECTOB = read_member_set(r$2); // ES, CS, ET, ON, BN
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

var PAYLOAD = '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';

// built: 2021-12-27T11:01:53.753Z
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

export { ens_normalize, ens_tokenize };
