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
/*
export function read_payload(v) {
	let pos = 0;
	let r = () => v[pos++];
	r.more = () => pos < v.length;
	return r;
}
*/
function read_payload(v) {
	let pos = 0;
	return () => v[pos++];
}
function read_compressed_payload(s) {
	return read_payload(decode_arithmetic(Uint8Array.from(atob(s), c => c.charCodeAt(0))));
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

// abc => {a:{b:{c:{'':1}}}}
function read_tree(next, read_lens, lookup) {
	let root = {};
	while (true) {
		let lens = read_lens(next); // should return array of positive integers
		if (lens.length == 0) break;
		let n = 1 + next();
		let nodes = Array(n).fill(root);
		for (let w of lens) {
			nodes = read_transposed(n, w, next, lookup).map((v, i) => {
				let parent = nodes[i];
				let key = String.fromCodePoint(...v);
				let child = parent[key];
				if (!child) child = parent[key] = {};
				return child;
			});
		}
		// mark nodes as terminating
		nodes.forEach(x => x[''] = 1);
	}
	return root;
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
	// 0x22 (double-quote)
	// 0x7B/0x7D (curly-brace, used for escaping)
	// 0x7F (delete)
	return s.replace(/[^\x20-\x21\x23-\x7A\x7C\x7E]/gu, x => quote_cp(x.codePointAt(0)));
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

	// read whitelist for exact sequences
	const SEQ_ROOT = read_tree(r, x => Array(x()).fill(1));

	// read whitelist for zwj sequences (optional)
	const ZWJ_ANY = 1;
	const ZWJ_ROOT = r() ? read_tree(r, read_zero_terminated_array, [...STYLE_DROP, ...STYLE_OPT].sort((a, b) => a - b)) : ZWJ_ANY;

	const FE0F = 0xFE0F;
	const ZWJ = 0x200D;
	const KEYCAP_END = 0x20E3;
	const TAG_END = 0xE007F;

	function follow_zwj(parent, cps) {
		if (parent === ZWJ_ANY) return ZWJ_ANY; 
		let key = String.fromCodePoint(...cps.filter(cp => cp != FE0F));
		if (parent.hasOwnProperty(key)) return parent[key];		
	}

	function find_emoji_chr_mod_pre(cps, pos) {
		let cp = cps[pos];
		if (!cp) return;
		let cp2 = cps[pos+1]; 
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

	// note: this doesn't use any bound checks
	return function(cps, pos0) {
		let cp0 = cps[pos0];
		
		// check whitelist for a match
		let seq_key = String.fromCodePoint(cp0);
		if (SEQ_ROOT.hasOwnProperty(seq_key)) { // potential match
			let node = SEQ_ROOT[seq_key];
			let pos = pos0 + 1; // check remaining chars
			while (true) {
				let cp = cps[pos];
				if (!cp) break; // end of string
				let key = String.fromCodePoint(cp);
				if (!node.hasOwnProperty(key)) break; // no more possibilities
				node = node[key];
				pos++;
			}
			if (node.hasOwnProperty('')) { // this was a terminator
				return [pos - pos0, cps.slice(pos0, pos)];
			}
		}
		let cp1 = cps[pos0+1];

		// [ED-14] emoji flag sequence
		// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
		// A sequence of two Regional Indicator characters, where the corresponding ASCII characters are valid region sequences as specified 
		if (REGIONAL.has(cp0) && REGIONAL.has(cp1)) {
			// emoji_flag_sequence := regional_indicator regional_indicator
			return [2, [cp0, cp1]];
		} 
		// [ED-14c] emoji keycap sequence
		// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
		// A sequence of the following form: 
		// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
		let keycap_og = KEYCAP_DROP.has(cp0);
		if (keycap_og && cp1 === KEYCAP_END) {
			return [2, [cp0, KEYCAP_END]];
		} else if ((keycap_og || KEYCAP_REQ.has(cp0)) && cp1 === FE0F && cps[pos0+2] === KEYCAP_END) {
			return [3, keycap_og ? [cp0, KEYCAP_END] : [cp0, FE0F, KEYCAP_END]];		
		}
		// [ED-15] emoji core sequence
		// emoji_core_sequence := emoji_keycap_sequence | emoji_flag_sequence | chr_mod_pre
		// chr_mod_pre = emoji_character | emoji_presentation_sequence | emoji_modifier_sequence
		// 
		// we've handed keycap and flag already
		let emoji0 = find_emoji_chr_mod_pre(cps, pos0); // chr_mod_pre?
		if (!emoji0) return [0]; // nope
		// [ED-17] emoji sequence
		// emoji_sequence := chr_mod_pre | emoji_zwj_sequence | emoji_tag_sequence 
		let [n0, v0] = emoji0;
		let pos1 = pos0 + n0;
		cp1 = cps[pos1]; // the character following the emoji
		if (cp1 === ZWJ) { // maybe...
			// [ED-16] emoji zwj sequence 
			// emoji_zwj_sequence := emoji_zwj_element ( \x{200d} emoji_zwj_element )+		
			// [ED-15a] emoji zwj element
			// emoji_zwj_element := emoji_character | emoji_presentation_sequence | emoji_modifier_sequence		
			let node = follow_zwj(ZWJ_ROOT, v0); 
			if (node) { // whitelist or disabled
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
					if (node === ZWJ_ANY) {
						v0.push(ZWJ, ...v);
						pos_last = pos;
					} else {
						queue.push(ZWJ, ...v); // save chars that dont form a complete sequence yet
						if (node.hasOwnProperty('')) { // this is a valid sequence
							v0.push(...queue); // drain queue
							queue.length = 0;
							pos_last = pos;
						}
					}
				}
				if (pos_last) {
					// if set, v0 correponds to the longest zwj sequence
					// that matches the whitelist
					return [pos_last - pos0, v0];
				}
			}
		}
		// [ED-14a] emoji tag sequence (ETS) 
		// https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence
		// A sequence of the following form:
		//  emoji_tag_sequence := tag_base tag_spec tag_end
		//   tag_base := emoji_character 
		//             | emoji_modifier_sequence     => emoji_modifier_base emoji_modifier
		//             | emoji_presentation_sequence => emoji_character \x{FE0F}
		//   tag_spec := [\x{E0020}-\x{E007E}]+
		//   tag_end  := \x{E007F}		
		if (TAG_SPEC.has(cp1)) {
			let pos = pos1 + 1;
			while (TAG_SPEC.has(cps[pos])) pos++;
			if (cps[pos++] === TAG_END) {
				return [pos - pos0, v0.concat(cps.slice(pos1, 1 + pos - pos1))];
			}
		}
		return emoji0;
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

var r$1 = read_compressed_payload('ABIAAQB6AEAAOAAoACYAHwAiABgAFgAOAAsACwAMAY8AfgADApQhCD9xcXFxcXFxcW5hcbsGoY8Bf9URLHl4F4mAXgAn6F1DBPgbACv4ZqZU5nHucWhm/wCYRQRDAJcASQwtAe8FzAOHOfQyBvsC+GifBANGRZDdAC4CJSwCIi8GFTgCJSwmLyQpNix4JTpMcXV+rQEGGggji3raLA6mlfECCAxleXQSxKUjTyElAibgTiIC0gHv1AZQBLNgQ6JNVpJS9wlNAHRfAXiOWADp7D9QqYZpggAHGwscRNcB8gB0/yE9LHw3ZzYcITAjCk8BAlASEDEWAjEMCTgFzVsHDywSYVMEXgVBSgCFDAQFAckCphERETMDM2uMA88yLkEnJgYTLi6LB7kBPw0nVwsQ4gE7YHTHG0MAJpANNxIqJ15uH1IFEQDKAm4FfB2eATAAeIwtpywlOBhEJwRXng4sHLli4Q5IYl7584oYIwciAIlLCW1CAFQULjWxMQNQS/8RUSEBKAMWiQavLFEEUAT7AK0E1WULFc3RYR4GDAkRFRAxEhEDAQEABx8IASgjAAJR4QwFEpUiGzjHDw5ylPEUpACEAX4jBRwWExgAGwkSAkFoCRgIAA5XWI6qYXEEjBQARAEhDhAt2CcBFwASAEoTJBMCNQUSphsCAEEXDnKU8Q4OA70WBRQQHmoJLG5nEwoIDmNYjqphcQSGGgBJASASEDPYKA9QDyQSCgQMShMjAxQGAzUCcRkkAIsAuokwVSwLAmIGPhgnKACLCRkAEicBAQbgO8+xBTABBxcQJgAEQDf6MASDMBD0HwwoDAsu9wDA6hMtcgxWABIITU3k0SHxGPGp8QBhA+dvYj7xAEEFTY2l8Q8x0RWBKEEG8QtKx0dLASBJGLFQ8QBfWx4AFKXRDyrPFXMcIgEPEjzcS9Wn/KALJxnXU2YJOBWKOmP82gdIgmNcRsDi+p7FBLYbwm9Uzs1RfCbNpY30PNDOtZBhbqPBybOPeWa7oi+ySNuja7E79Fz+oJqkWRGdXLqRl46pfoUDu0uKXTiGuFf3GtJzAXtJmxI3V8am/mpQnjfi99U7ZkojTh6fKYexodlCUm8Nn5tkJXqdPwxaQiU29Pa8nQxhFccS0ZzA2p+XNo3r68FBGjQNasxwtQH/0ELiOQLNuyc0YqOxCPnfFsvASXVP7enrn5p48UHDGS6NU/kYR37WSJ7+CN+nV4NqWlRTc/nQOuWoDD2Cnkn26E21fE+79xMXG2voqdtyef5eUY6MOoAAPIvdUDW+i16JSxe2+srXAYVvzbE8SKhyxzjFf2rMlgMycfXR8nl6/xF97xDwBSNLExVnK4YUGbAMpgGeHD0vHVXsIK20HyDdJQ9a5Uhwta5o+Tw/HpthmalqVX7v90SgUzjZaEahH3JPOhT8k+LFPClF+c5gMeKg');

const VIRAMA = read_member_set(r$1);
const JOIN_T = read_member_set(r$1);
const JOIN_LD = read_member_set(r$1);
const JOIN_RD = read_member_set(r$1);
const SCRIPT_GREEK = read_member_set(r$1);
const SCRIPT_HEBREW = read_member_set(r$1);
const SCRIPT_HKH = read_member_set(r$1);

// cps is a list of codepoints
// could be empty
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

var r = read_compressed_payload('AD8NqQQsD7sA3gHxAGEBOgDqAO8AeACzAEMAcgArAGYASgBvAC0AcgAbAFMAHwA5ACEANwAWAFAAFgAmABkAOAAtADcAEgAeABgARwAJAB8ADwAWAAwAHQARABYAFgA4ADYAMAAtADYAEQAtABAAGQAOAA8ADwAcBFsFUADoEbMBSgoOYxgLLQD6AHk4ZUoAJHIWAVYsA9sBlAFMdzd6U1FuhAA79YB1AM8BOsYA0XTJTBeTT9rBAhkCTqcDZEwAxwOsAF94KiYOjAA0AEEBiQACGgFhATq5iQWOEQ4izBVXzAEqBQEDGQguChMXD1YgATcEBA9BChRExw4JJQEyFSQUBAUURARHLwuZJxQAqAGp3pwDdDETAOkcKF8UANQYxFWU1CEWBicKBBQUEwQlJEzSAr0ApADEJCQ8KwkABGQkJAIGBAREhAQAFBQEBCoVDTEEVBQUdBQEBISEAxQUJAAUGwAE5ANECdQ0EsQixAEEFAQBp2QTBBUWxAPEIbQAFAlUNBEnCZQkAyPEngAUA+SUFgV0NEMAdjYZABmWB9OlxA8EpBVUMBQlBB8pDjkOEg0HGgEwDx0KAxE4BBoiGIRVUdEMCgUNKmg/OvsNCwAJDwoFAw4NAl6IJQLzAQsA/RMPFrwDmucAUC+JKKWkDv2iFUYb9RIPcgFmE4QGwBndXxbQ5Lm9ZAtDJLQVR6cAJxUB41V5AQccUw/bH6s7AV0FZQXdow8Ei3EPA8cH2cEGOwP776+ciQBldwkEZwUFLQeJACUARQKfCFkXBaoFykUBINkIxTMDuxRFAPc3da1lAAuHIgAhAYEtsQAfBVQAbwQBJxvjHiIX4x8f9gJ9ApwCszQ7OAgFQQVmBT8BgDelBWUFPhw7CZsJnCglTQMIEVKmoM9D+AU5Ysqf5jgAGy0AJgr2J19XBWIApeMAJQBDAQSauG0sDQCGARTFFsWqBQHawgVlBeoC0KkCxLoFClYmpG8UfRp3FY02NxAAxS0jARkNmQBFldUZMy/FACUABQA3oycA+RVtm/FvRQAJUwGlyW0WHwDMTQESj1sAxy0jARkNAoIE15XVGTMHjDntAAUAJQc2EAWEVr2b8W9FAAlTAQBBdhE5BwoGB5k3ApOTQN0HAK5ZAXEAqxcD4QCwdQE/uw8T9ScAB5UFRwA2lzkK9tQbCNLLABADnqITCjkCjqsChuI/mAM2owKD/AEpzxMA8O0AjwFLAjcA7IOXCisKiplfAFMA7AorACHew9IWClAA+WcLGQsfCx0F3gAZAEE1F50VgyNLAe0RwQI7IxXNAA0LAH0AcT+xlQWbAcsKq6+/ASVtiwF5AA8TBeYVAGsJBYuZ81OxBCkAGXUOkQCYidsBgSs3A6UAcQXLAQMdhwV7BdpB5dwChQBcZ70AVgBhAGIAcQB0AHsAcAB7AHQAiQB2NYQZBlRTUxYACFRdUwwASADXEAKsAtMC2AKZArIC/8EAEQDEAEG9UgSuBO8OSy41AekRwTr9N2YYGABClQBKmM/MAbsBoAItAio4BzgEArMCqACFANcCjDgfNCACtjgjODwFY70CmgKiAqkBjgGdArACtzTxNIAkNPU0kCAAXjWnOAgFQTQXNC42CTZMADaRNlI2WTYeNvWePVw3AocCpgK1ASwAOgVjBWK5xAVzBXw+KVbDUrA06TTEHAUGUwdW3Fe/oXudZmmiAhUdA88RL/uBAS0ErVUCXV0CfyW1MQGZra8/ZQNPIQSNaxMA2wUGtUk5LQUHMwJDZwB1AWspewCNJyMAnwFTwQAxcyEBuc8DQTcrTQddAXljBm8BAm8A+1MhAzMLDwBTSwC1AwBnAH0ANb8GEf35I5eJCQATKwAzAL0lUQEB2wHlERU7l4IJRt3KEGkQZgsITRNMdkQVFQK2D7AL7xEfDNsq1V+nB/UDXQf1A10DXQf1B/UDXQf1A10DXQNdA10cFPAk3coQaQ9SBHcFmAWVBOAIjSZTEYsHMgjcVBd0KBxRA08BBiMvSSY7nTMVJUxMFk0NCAY2TGyxfUIDUTG1VP+QrAPVMlk5dgsIHnsSqgA0D30mNb9OiHpRcaoKVU+4V/wARQsAErAAEusASRItAFAxBkIASOg03QATSwBNoABNzwBMYh0ASm0G5QBQXABQkwBQTgASO0lsTnECyDqyQAIKKwmdb8V3WAZHECEnqxD9DDkBuwFBDfNL3gT3BkEEzx+DGR8P05WiCKst4wzzJukup4BgI/sqiQXzS/o84wtTUW4PXwtrCek6aYFUAycBEyKRCuMNPwhzEPkKz3EN6xFLBz8D20mgAKsHBwsXHTsVuyYWYrILDzl9BwEa/AuVJrUTL3sCBdkaJwZTAS8bBQDVLu2Ftlo3XCJPZQYJCysjzRSuUCYNK0C9eE4aIQcbJa8Cl0N2So1RPB6ZIfw8Qw1sLhlRggf7PAsZVQuHPKRGsUUUEdg+kz1OIk9MMgQ7hSw1J5EJ1Q+LDL98eAFfCScJtwx3EzcRHTfLCD8HHzOXKicbCCdGm2CgBP2lA/kT1wMRBUUJRwcZA7scMxM0FS8FE4Eq3QL5NtsuuQKVVoYBHQXRDysf5RBWR+YO7wihAmsDiSXxADMVJwAdIqEISWkAZY/eUwsu0QjNanIjegNtFO1nEXkHlw5dB60cORXFHOdwzl4Rhg4oqbUJYQF7CZ8BZQTpCA81YYymIEdnWYteGKEgZ0FFXgICNwxrFaVEw4d+ApEPcRIhATsBeQc/DQcCfRHzEXEQmwjxhgo1uzP+OisEVSGJIBcKLQNVbNQLLSb/DP5vAakSaAMSNEN39GexYLwqGAMHHzLLQWYh9wuYT9MMohrHGEhUNBnqB8UD+Rr5J/BBXQYFA6kJGTpTM/QEwwtvCJEJRQBPDqkdB90YcAp3jNYBN5EBvZ8DXZeJAnWVBj0HEQBtEY0Ff+sAIwKtCKkACwDVA10APwKzB6MAHwCLRwFDAy01ASfrApUDmQg30QGbNQH5LwQhyQwbAP09blACw7cCgHBmqAXjXgKUAk87AVMrBAtUTVcDtXfnAOEAUQYZ5U0BG7FQ0SDpSQHldTEAzQEBAAs7BwtHAdMB+XMAvQFlCzcJqLm7AVPvLwCJABtxAd0CjwDjADsAhfcBWQBTBV//BdkCVU8BFzceMV1nAcEDJQE5ARMAfwbRk6vPDSUEcwfZAhAhFecC7zQHuwcDIuUT00LLAr3kWwAyHABlDBBgYWY5DDd4Xt4CK1AAUOsAUEg0nzU2W047AawBry4Ct/UBbbAASQQCt/MCt7ICt7UCuuDSAtcCt+ECt9QVAFBHAFBEAlKXUogCt6kCvD4ASQDRAccDnS1dKFLFWlItK64Kcl9LYfEMrA3aRM46TxPhYFdgOBPOLb0UxxXUJVwZQxrCJwsl6lUPDwot2WY2CDI0exfCAEUpboNHY4weNgpRHO1Tl1T+LSEAt0uoM7UNshsbREYFTXXzYjAWFAJCkwJN9gJkhwJiSGFTtQNhNyYCof0CaJ4CZg8Cn4o4IRECZkECZiwEdASFA38ZA36YOQw5fR05iDopKQJsHwIyPDgQAm3NAm209ZAFOW1LMQFtAOQA5wBQCweeDJMBBBHIABO7Anc1AnaoRQJ5UUkCeMAjYuFFtEb5AnxFAnrOAn0PAnz2SAZIg2kqADEbSV5KYRsdStIC0QcC0NJLLQOIVQOH7ETLkTgC8qddCQMDtEvUTDMrCdVNUgBNtQKLRQKK3schDSNJbQu9Ao49Ao5iRp2HAo7fAo5iflG6UzsDEFLaVIsClAECkxIA7wAiVSRVtVXWDCwhKZuMMud4bEVBPwKXpQLvuFgnrgBfKwKWlQKWgqIAr1myWg+HUwBBApa7ApZUXEpc1wKZ0QKZalzQXQ0fApyhOcg6owKcHAKfoQKevpAAIxU3MBUCnfcCnpgAu0NhOmH1Ap7ZAqB0Aa8CnqUlAp5Uq2POZC0rMQIntQImhAKhAQKgUt0CpjUCpdQCqAUAgwKn+GiCaLcACU9qImrXAqzpAqy0Aq1tAq0IAlcjAlXiArHn3QMfVGydArLDEwKy7Bts5m1pbU5lAyXTArZiQUVulgMpSwK4ZAK5TRsCuTB9cDxw5wK9HwMtuAMyFwK+jnIIAzN3Ar4gcyhzVQLD0QLDCnOIdFE7S3TmAzytAwM8oAM9xQLFggLGTQLGFo8CyG9XAshKAslVAsk0AmSjAt3YeH9neLR5K0vWAxipZwgCYfoZ+ZUqexFemF7BFwLPcQLPcjVRWdj5GaUAzLMCz3kBL/ADThh+UQsC3C0C25AC0lUDUmIDU2UBBwNVkoCPRQbRHPNmS3sFgtSDkwLazQLZ5IQWhE+nQgOGqwA1A2QUhndf/wBbAt9rAt6+eX0C4jXtGgHzNi0B9KEB8tiNAuv5Aul2fwUC6v8C6uoA/00BvwLujwLropawlwkC7kUDheaYf3DmcacC8wkAbwOOHJmZAvcZA5F0A5KNAveeAvnfAvhsmiKascE9myQDnYkC/wABIQA/nyIDn7kDBZMDpnADpt8A18sDBnChjqILDwMMTwFTASUCuwNLAKEEhb9tCwDBBHHFF5EchwCJEQAdoUMEoxcdhQFpLScAjPXhCwDmqQ2llwNrXQN/AEkHw74EW6nLCACxBRvFCPMnR0gHHSI73zc2QjbZNs42SzY+NvU24jZPNio3FTceBXJSX3EbX8YAls8FPACQViObwzswYDwbutkOORjQGJPKAAVhBWIFYQViBW0FYgVhBWIFYQViBWEFYgVhBWJQHwjhjwCzAAYKDAwKbl7zNQTTA/YD6wPHAKkEVcXFAMUEscUA8UozGLIDWgVRBVA2X3lBX/IAWBsztQCNCMx1zAam8UaERzAtDjUgMUA/fnffdMH7GcwscwF113g6IQVpBXTJy8nCCNlT9VQAAAAKAAAAAAARQgoKARFCABtMAAAKhl6HlZMdsyIVEyBvty0PAIzNFQMLFwDlbx4pHUJCLV8xYEAxQi0Jy0cACk4dpxzcTEVf1VhZdFcUATYCdV45AAV0AxV4KV/qPUQlCXGlCmwdxRzszAvMBl/TGCk4EwESEwYJBAksfqffdEQ3VCHJtcm2CW/L1dYKakGTIdcbAJOXsV8dbUPOQgo9AZdflRQnVlF2ZTY3Wuu8HAqH95df6xJUExg9Xk1MQQ47TZw2CouXX4MSXSwtIgE6OwoPj2vwaAp7ZNNgFWA3LXgJTWAjQwwlKGC9EAx1Gm9YYFcbCwgJZPFgH2CfYIdgvWBVYJsEBIRtZbAAgwILRAoZKURfNx9ESFGNBhKQAJoBMg9Pd7QAV5eqIjFPIQWjpwYjBPUWdY/dywOmaCcBt1DMWWlVBu6oAcUU99IQTwo6CQMbAQEBASACARIGMRRWAYcCeQiTX6sCFAUJAnCNDfO1AQ4zdJ8W9yEKOrJQ+AQaBU9xAQMAS18AQhQid4k/wxg/NtPIUwBpHkwPACRKwQQC5QIlS3ERJwmUJAQjzgCABKg4EwQA8KsAbiE+awCrEg4CVQOfAL6Lj4MCvbrEEyBZADWTAHYVAGMAlQDFGQAzNhnMDkoPsfDtNBfLAxoKfR8BAPCrAPLAJOKgAMtQBnmU1wEEFQglzwDLfDyzdC0BKD22AuatGv+TGv+JGv+PGv+hGv+TGv/DAx0EEecB9wH8AfcCrQMdBBUDHecB+wH8Af0DYw4NDgMdg60Atw8REwB1cQ93tzcEIQMFCGIHuwASoQcDBywEOQSiD+cvS7FtmQAdAM0HnA/nL0uxbZkAHQDNB9ADKQG0AEAP5y9LAFuZAB0AzQfQeAMdBBECQ+cF5QXkBeUF5AXlBeQF5QXkBeUF5AXlBeQF5QXkBeUF5AXlBeQF5QXkBeUF5AXlBeQF5QXkBeUF5AXlAx0EEQJDIwMdBBECQ+cDYwMdBBECQwIMrQDx9wB1nw93twJDNw/nL0sAW5kAHQDNB5wP5y9LAFuZAB0AzQecD+cvSwBbmQAdAM0HnA/nL0sAW5kAHQDNB5wP5y9LAFuZAB0AzQecD+cvSwBbmQAdAM0HnA/nL0sAW5kAHQDNB5wP5y9LAFuZAB0AzQecD+cvSwBbmQAdAM0HnA/nL0sAW5kAHQDNB9AP5y9LAFuZAB0AzQecD+cvSwBbmQAdAM0HnA/nL0sAW5kAHQDNB5wP5y9LAFuZAB0AzQecD+cvSwBbmQAdAM0H0AltAkMJbwJFSPNRxWcsnvlYtKNLoh7AlPOi2s2dcBdveHWT9gvTrY9bUPpmFr9eKmVveY8kMiU/56VCXN/V9a0+h1j8Xhbn9TyxulQQe4htCswQRGqlIAa5eiEjvNFg/99WhxgCzCrsYA1EOdDyjeUV3U2THNc7H3pZJ0KbktGu/xK5UlpiLHAB3sUNEZIcw5nJFIwUnjgbvMOaO4KSBOcVDOadlETKd1Ms5/csovJli8Sm2c7EO+I58N7f/oQ2n5NHDNlaL5sY6DP2pr+TrwfwKeZHJ5RLOc3yBWVAF2d6RmLY3C7pUZPRtL9Q7hu3+OswreRqIoEzPlmJ+8Wo7LCZcCsi45YY/TBYPfxrZzPT433NhQ5ZRBdV2JHJKoVT+190M/4KTAidq53op+zAph0iuSYA1fEsGlcKJi1ps1K9WjFabh7sW0PtVvcyZs+c4jPEhIMpPJ6UHRXdi0ph7KTAd21FH67PAJJCfTHogswwvdUisRmDwboMqro7i7cgzdHYsG59vkjxyjA37AcGzAeUDx6hKs5CgjEOberIWcVuk0d75ieBr5+ixWA91bb7yD8mLBHalWNhKIn5BJSQ2lux0/OI7J7in95KYL81dn5Mg8d3oqzuACH0cogg1GA87xM+64juJ7/5yqJQgxHHIQXkfQWAR4MiEdHIu76Dc5Onas5PC9kc5GxIlijAHZtrsOm3Vt1g+nJqxx6HO2tHMifmoEV+6q7NIPYYEjJzFNlM78NfGs4h8TNZoLz3yZpHzoUL5QxL/Mwg0rtrezY1XQWq4flrXx20pN2M27Z5JrMxdFpVuZE/OhbmKuCg68YDcfuQu31lrxIlNjvAJ+vOb8TgU61eR0GwJgnDUFEom7aBdAWDUkEDlqm5DA6St3+OBvzACh0FbqBCWycD5Xs5MJGs4/ZxciEXBAW/YJIDskeDva8QTrw1w5bN+yB0Lf74PYnfAg3s6qlqKSC+3BwwcPNWG2apdF9LCA7pQXfPyWbd9QQwepKEenMAx9An2+tOpTAQwbtynUEUkwTaeYbeZNgVMuk44uuwlCckdcPCX5uK+3TYtx2cnVuCyittrPssVEmV4MJdssMgFeaN8WWbQC/l6s24Dsa6trLSwHosZxNAbpFARixjWZnN93ROnMsVQTKGKe9Mp6GA7Z75cRRaYGeRen2A6j8X38ZQWWtLQecGKXWri6G6xHyA65N+HleCiQVhStIX4NRY1L8xxxcJrkM8hnA8qqmWWnJnFBZWymyEhh1E+94JPwQIWhYXeUk3yvFUKsMeoF0UVMaPxKIK5wfBHQMx3di8j/zmcWmP2Q1ml1bGaVEKtLmLaHIGR2LYcHjY92/rk5U8wjkHlTiDNAzim5FzE3R8aPz8Gy7er2J+Hc2E3LspostkN7VseQVlYg9xFqlBbFiIytJUlp0xHTnOB57epAkEzCeST7TS90ySyFL1BrUOJS0MZrZNygHuLNbh4pOHFVJMwn2m6IUjabnRR61QZn7ZzSsm8Pad9bYr5LMrUysShdjOhARIVFPKeT++/Cgw4Blg7kNN6kyhYNdeWM+OO9XOCPmdMq4f88JMYCl6uPxUiufAfvIciuD0Kpd7uGoOD+YhyTgD5mh8D6rL8NR3BicZOurVYRp3rHy12NHkbILecDei9SvxBD8LctV40x7tk8ZQ162oBkwL4aLfQzVxdNBZNbBDScFhOji3jx/6Yu+d/ET11gJz+PI5ZqIT90PEasfGtM8Mr87EcBNksxjvWF/LeCVNmV5we+RFK5Znxgz7+XiE7dIddRIcw8I8EBxBmfOf47uxj3ue3tDATgMH9Sq8Y02dRg/OZHI4M/UN36WhdrWpPZHWwEP/Lt5MRtpJ9QWleJl83rzBHbn1hbIo2bHWwUY+JwPNdIvKvYJcAb08BCQC6TD4fQH9yCSTI3gRrO1oEVqGvwUcW8FKiXuhtW/uzPoy83/Wt9/mfp54XXJQndd6dtlZo7rvcHcKmTFUKJcmJNQCtC71U+yQBUVNhs3ZgdKIMGfUkLbedmC7/rhwgjBxjMjJxWqE01rX8jR9zuQGI8h9kZThC3GNQOQh/xRuS4Dke9RvbvPQM5W5JDfJlLvFJz+iCHCYDgEGa+L7XwxM7kPUIaTthGCVp1TUYvh6g4lvuhVySwGohJst62qMYfJNfGWHmxanWkGCcWBUE9fGwWY1TamfkVQuzKWorjwtSdsaAjJEcWlLvLAQ1U06HBUL/lU2P3s+GEIHsRQVg4QLwRZOqCFzcp16qgau2qjT28/N73FwviMkX9Czh9KZdt0SS+rKSJ9A+QulscY5m/g4Bgjd7LyrFOB8WcP7b6nDan+wcj1S97r74ucjGnKfQ6DtEPo80vrnUwyZegN+zpLj9/UZTy5ybyrvC5Ry+Tcwscm6hQGHR0qc7HfJpTqWlNkvmLPbpClB0rsWMPPgYSeKGQe3CNsh2bFfM8ka1VciuG89yRaK9p3aeir16MEoKuM+CHI24Sa7mFgotRlCgyVz8T9Hfy/ITcJ7ie9KejcZts7yIpuKZyIOfyiCpbgVTQVwaXr/eVlADRQx4FtACz+fFmGuM28ZKqnmRHlzM782J2E4J8b4gTXLcrx1fDhMu83ZgWij07q9yX++tqJEG0tvOceYGhqcwmKPx3qLxQEbWf1XJT6ig9tqi/YK0RQf72ycROZ/j3mF0Un7LS/+jBVFXNXHeIKUsbaM5DOiv5TUr//ZjsvbsgFsXK3eYuDqjMflU0FPTf3vOVDvetKvw+fzj9o1yCctbLgo5OmFFPGDssHNCLK8YvLxJjP4YmLd6oDSYhcaBduYPBSgKhDxu9ZG4P0NvAP0r4VrRWUVj18rvF/pxJn9VH1S2nx3yjf/lEfvl/FpfYfwe2lL13Qj2h96LwNq4UQSKHozkStZLRhBXj5uUEoxxx6UW+LkgulmSQa8+fvbCrmImvm+ZlkJnhnlwJQuB+AIdkyWHyZiUxIUNMRyhaC4J8fhA5OhyhvynmE2gWtc2vBMbnTxcD3QukN6GZxJMNStRmpj4lwO+UkR7UEJe+dQy/g9+FpLpPyplAhTAcoog7SWazPHcDQFVQBHawG0z5xwSv+FcQyQ/tXNYxbTRdMFGQynSMTi+oZsF61dVBlZfCJuVWJ92pNuvUgSrHVMrP5udHE+MRMmuV/bVwQWos5mlrTRd5jV+EF4UTHwiZd0gO0bgJj6H/SR1g7ObNMoPeWv/kWoGO8QnD1NE/gc28jRss1BaHvs+sTBFEb8k0ArU/ddtjxCRhYIqH+sVvlSJhsGzW0zkylaQQGv7B2DMOoK2SW5dyeEZwGXL3pwCocOD35oegfdSYjycVHR1OygmowDafiT+bF5Q63nYqJhQgr1/Vt9YYn2Ay5iVZ2B6gVMQEPbopHwD6dwjXdV0WgtE29I8Esh0Wp6d/QiGskjO136w+9v1khM3YxP/hBfLF/el825N0JfqCj9ahHonKZmOfqmXXAeXbJSM6dUK1vbJDxGbYjiLBwNmq3LbuF+z2QZ0mfzIqsWzff1n13vu1ETsP5jfDMXzZ0j+diwfWGpCWXvJTsyFKRVN99zODVPPrVVTOxuvE9DAcQvAdS0KrZxH6ibgZU9OPJJB5izWAE731GDbIdYYvxszTVz7MzOog5ss9osQZkS3IWRzq5FkOzOuUnQz02Gi/atg6HWDqa8Inzer7iz+RmHE54QbSbjquUZ0cShy5tP+P1fGJ2MvXkW42t8wSbQ4MLEZpONNIkowdC7PrNgqHKtd03gtubIqCkuxT3192Ed9C1PhD2+NV8VPiHmI+dpmg74AeyaPdUlRIIvzn/WlBXIeYDrtv4oriULrKVkwK4vpKApen66EZomIsSN86ZWGo0WjIxK7T9EiBAYX3FBkydHGFXxaesJdg/iqnULVDhRJs/FRcn2uzqw9YO4MBn5+pAUJPSaqa0pCJe2dRlYUrQAs4TOQqWudIu6lG7WJRxTOCS+muVVD0XvNehnBpTPgE7dPrcYZSx4+aTJ07ABN+KGKCEno2gQg3Zmf/P0GCHXpNV8HhJBq5lYc69I0sn0bKzrtzFYd63W4m1CIfC0PUBac0+yOlnap9pyRSTePj5Bp4B/Pla161dZB1MPiEUBQEJfq3xabu8yua6PYbt+VOFG1JeM1gpoC2Nb8ShLNdb8l2EQBtx6gol0vhgU08yRIG7ARMwJsUdUzXIKCwYEZK9WMUo+1aTWNg/WrABeS90hkputUneoaKNJQxliaaUOZO60B1xnTQH7rc1Ese/3qTPsXbVrx/hsF64xU9wM0266w7Y1rm9khR6J9BYIGa4e////y0MBInaLguz0KBPHjT6DhRYFrkMMgCX2ztvwh6J1kOHoaTC1wRTQjJs8T3nFwYsKJK3IPi9/DQSrHNZWAqfryQ6UC6xinUDDcYBiueipGXeESUXquhfJGqXcaIhD0Rq9BT2EKIO9HZjlkOBdi2iGiTmQMEaCPJqYkxi3V8VdZ1Z9VODb0E1OvOE7LIznAPJuarw+EKfczJ/cu/4OKTWsMOB/SauMAFiyomfdAa7nRKAXm98ojvQ2hNtpWmG0Pzj0KYAJTfMAdR1KW5CcJhvrT5UN5v45V7uZbT5B/rYhsNMH7Blf8WLjMnjO71W92ezc79AqqdhM6z0bdLEGdrHAsmHf7gZ/ba8FLLNA59CC/HYRVwupN9wqzyjLRRNaeNeygB2yt/hBcDTFb3JA9pFXD/7CFFhzbTm43hQo3mBRU2p2MVtbzhXNv1/6VsmNTlz9y3hAieI16TOub4a7FeJUKMtksM7oOP4xv//3QpoAjP7lp4OdmSrYnF6vvkrRIYa4qcba+brJjQ4B65e7sTZ+ffYeRhiv+qDxBcMimiM0r9Px7jvRa0lXNFDAQQjH1pnhYgDv3yrBGqBjAiR5zRBgTtovKgKtt5KSaf3zXCJRwJFKdkka5/sWPp4O2RskKlF1djr//0yfp/sUPfyErVxZmZ3RjSAK+Sg2a1SJJ0sIrvcHWauC9bEVTibH31J/ZWyHn23Rkps6dfNOer0hO4CVph1E166jWOQwJgtaTeI0ftG2WTehz4GyH/pWOpit/1fXfnzowZzKQ9EitDsOsn3jpJrVq7mRm/snwNwL4ZbSmeU3e9etiBseTLA7vm4OEF/kYSmsF4Tj+7ErUFxZC2qNKr0OlvcMOc7czJnGOtxZpjrdljk9xwyi+2G1Pcb/hCnBt2+9Le2pV1GFNRwLmiEygmUEsxoxYK+w3JoDDOT1RZI+QM/hMd8j4Xz5axrDueler1dqyFx8r2PYYhcc0CgPCapLrMaSzxB4Rx33UgIW/BmfcRuGDf3gBeTNIw7UKcZOfcj4uUDe82LlUAqyvcd+sb10HZb0a+TfwBX0v7tg2zTtIHoir3kkgYU9tm3nTUzKRgrLftEAVcrQFtpd+2haRwGULFWPUSxdKsYXuFke+aNwzxqpvxoVOGkxs1FkTMH2z3ws7FkS508+L47WGVHHHiv0Vx7Uo/ptgC37OG+vPn6rrHJ90iwP2xscz8sG53CrQyWFj74B0/OxFWvdet9YSz7jIjMksT3oTbXaMXB1ViYZRuMEJeqZTH+CNWGMqqi9mqnjl226sV3yIoiPdHifg1HxzYl0ldG3C20nvLeT1wjOOMLzwwYzJCFsk5yLb0aBOLwHCpp6UpYLBcjanO0l/w6udx/E26rNi25kDAdZ+nAqd8t9HnDlhnU+Q7OseUDfXvuyaCa5IZtoMtzo8NhZIazPsSz7POkt4VN+C+it9tIxmSoOhZq0Kq9vUy/m8M6s2pRBqm1McdRd5ZhlWT0qmVtlcbDXodkevGX0Su4Az6ze87jrEt1c2JwwjBtWD8KOzBEmaCqYb18QFtZdyMrJjNUUQTH093wqSXNo9MnvAobCZhqXfhgzdzW3iGTferpiZoK5PCFysE5fOom4Lz2ABnSgezF0+u5WlcjF0vByFMW/EfbqHcnvlrOdG1DWsEzyxDG7a2AQf7yygJ6vi9hfNOQAL1zXQCObr2okXGeOcLzOExfnwJWLScDBl7QVNEJlBNplwAiAhi3DCPphlboC5uXHzayTBoScBpvANGm/wHSLWqpUXID/Vb5O07j9kkLdxsrJUnOPwiKKoTTw5wUy2VP7/sVH+g0sr5pNw7lD6zH9caKVpvbwNbPREqfh2eX5CdkXhVtjV/MjbpSq2TBD5uwq71MiuZdc5knRTRe/YZFsaBeG0iKRqL/xj8B5aCNjg4i8CwGOrMTZDLngtBinMDHTbsiJ+5kB8JDJQP9ZPwCZPwSEtipNcbIWfbTFQi8FLhNkq0QmFBO87Yze1Sc2aEJIFP7qeb+uWGbxPJpX21ioaVHZ716eX5ZpV6U6TVJ376JLZOpfe59Go6yyg6ElbkzWFtCgfQDv4esiziT+QV98QIXrgDPRbZktwD1FSNS65yT6H4Am5tczl9i7rX51lLetnrY8+tmEw4w8BAB/4ryYZjN5n92NHMOsAwxbH4GoBrkKdPFzRM8tMCvFdWYoYXHWDaTlCSkbeXSK5DU4kSvfO1IxAmud2HH4O4oa0HAqVvpUxGzFqPQZ8cVggccZTzEEWU1RF5o30nLbU6IDDoWVaQl7LR/5RfqVkJCJDeNphIFI8gjCuElbTa3ITHLM5TrTGFPwFOjG3Tlrt80Fc7p1NP7sr8XiUtUGrZ+6QUB0vG5kLbX5ElU7qdoF5bgBrhzQ14CHtnwVVgBW+N2IAblIemAQh9qVvuPTRQZ2aQXzS86T8y+SpIJOqPEqffa7MCNuff0pxIOJ5rf2PTo7ERtQzD59TcFmkBDoF6O9AzHwa07iUmV1XBkJbknLpseUjZfsq1XE6IB7uHXPUl44O2w1Et2AWxpNe6YN77tEghBoDw8bicL9VCiNawhDA02d+ZPE67U32JQDRVS0BTVZLlqdUte48ut/gcOlgPb1jpUP8+7oKEdSTZUgnrjufDxHuCDnst2i1nPNWk1wbJNPh0rsQvxegBj/bYnk2DA/sR3JHbpeN8/PMyMgBgzqhTe4ME06elbUsI/6LVG1OsiXdxHKZQwJwaawYB66uvRX0J+aUUxH2078F8xkmipjuBF8xrQKvq9StxWAbVTzU7QhXmiWYt+/3GU8tjjtWCRf8OIDGOvTBeIBSlUAUDbyoXPJJyJa6/QNow0LMqG4+wby7xiMnZjSOPtSRhddu+Lq6RXfi965yCSTI7djXcWyVPEh4x07VpIIVDgOWsmEnJf4D4l6CtMpMvcZ4HgyXmcxNMx52M1Mv/P2FAO1JyCH2QMMwN7rOSoV5q9ZSacQwHGECzZzJQ6gau0A4oT82hGQmrIcKh8dp8eRJJfpen88bWdaxWXSsogyE3vL17ILDzFezLVWUPqgBtEInDhdrQu+0/+lILx86FkXnkv1s+3N0iG6aoRb7OncPHgGid0oYlvQMyHTFFS2HxqrBeN1jC2u3yJzIvVL8fIrJF9O8ZvarFyFFh5sIORd/jHi6vNGfrCBCbt0YmELdo5wfd9Z6ZmpRfoPI+4QjhhwNMATypTEXIHw4pWjaHH3ZXFKg2+cpwF0l11tSaAEpT1/6r6cb7bkD61CVWl+87XDSLNjsb+a0Hw9j4jeuWbtCb68I6a3sv+zI7U1gs0UWBg9dbNtQ8X4OK4tNPr7jwKHxjD1Q2JYoKRs++ohnB2B/0gg6OPWEyMjFp8NK6L5vviCJUJ/DM3OQRpjQ/+LTSciBiwQAEF3wYtjRUDmd0hJsAaGa2AjTLKZaKgX6YTBfTVgKAHwqOkTrF4UARAUxaagEXC215o/A7dPrk1d6UwBpcGe+j61B7NJ+WvsP851eV5Y3roYLtJYUxWel+0gXa/sacZjkUoojon3+bgz3Dg3Yb7eDErLGZnFeX8WfUAsWzgCYJOyE1fnV5iDxbHcfuRbcHs4BYewhLUEgVk+LCHUy+J52S4eLt6Idjm52FQ9ec9WcMnadBQNRO3LIy44wtzvgbvXZDm+pnqwrLf/nvlypiKGxhxf8X0i6dz8DJ2dpBmXj/ZI5CGJwRXL2I/w/L7bTVtGaDdhaEgUrNkmdX1qj0yh69kgTgkad0ftzM9skQYIcS4qqcBcTtGhvcR2zWe2yp79sn5k/gB3Xma6xvSSocNQ98FcFR3g8COrdpYDtTeMI79ZjwHo86TJySR2gwOmnF0cQuRmAujE4DaOkL2q2rCM+CKqrMfpUHlDKEVzyph6zFo4RBNi3fjQn1SV84UluFiuWyGiCyaTOL64boT4lpbzC9Domw3tR1pNDlkOisZ+tLDeUhyuqzhUiMnA2mS863e4VdMarg2qnsGkkYT/1532dNCJaw57G3Y33HEitaGHIIaqbUWLru/gjSnphP7tah3mY3tj4H5W2l2gPSOzkevVo8UJM9kFzpmzrKzsS+RWt9rp5wKO0WKO6WuAtkLSTyJQlRLcF0JjrBtV88Vj5+s4gO0DCgFF/yLkyaDArJhB5OkNoVXgEGOwPz+A72EiIKF+ezZSvCvdG0eYRyx3VuOKxvIO+xe1y3lLWOCBoftB0xhVMNf8hudPSFtOnQZ0LZLWJdYbmMYY2pVC7AKia0mFdTtQnfNRIlpKf5QgsqfVqTQZhUmj0FKbHwCJ/Sec3Xgzb9rd8+cEWwYB98WKnfEqRVNrdTdRCPxDzHCk1wQjveVSbsXua7WZt4BEX3xZiuojo7SAFe+FVy5bgA23cdfw4Mtu9bchWzQtO9ZuyyrVk6DH7/U5f92SfOVVzH2uaE23zhDyBGpFoj6R6LoKSV+dfuu1Sap6ykiQcKA5RhqovGSWThBgk/qmOBxypCYk56NlXVEF+rV5MCIOtCG+z5ye1gsLUTM8juO+ZcnpePS9xiX7nvKl12ZZ7qehG/tfiZp0lUZ8eW32eDlLO2jUARv2sRJp5kPRoH4ktL3S2cIiBKAfmWaOuMZ7SBoZT1JS+nu8cng8XuKYenQO85w2sgwm9BOgqoLdoIOkM2j7d3w7y/Ceo1PP9aN9wzUxCVPrcVZs3r1JcszeBuwMaEyjBqQWucHHA+mGXNZizcgZs8YP1UCo8ZXoIEl14dTunYjYL6dkZYT45zciXmUnhGIz8xFXe+mL9BdGK0UgN/zS6+aC5RCtUsB8AxasrXVkHBw5VmUv+H+FmZ1gWXdCt+Hrx0X9DCramkbWNxUwFg7aPYtya14vi7+fXvTY8qqx2uogzZtOFtSwg9u8E99M7AuAnqCkKB8w8PyzKBhmb95z6UqbHRp27clSl6swp6aRljJtffazf+NpPmh6lKfh7zSw+Lbdgy7Q7jcqRuIIORVaidojjEm2OR+AyulJoPMVRGCp8Z3nCY0NmCxuXwHagaJVg67LWEWMZaF55j3Sohv/N3oZuBV6fIxOWgfnEqEtPXsFIGWii9N68r9ZvQoR1gDjPCu+Shrrj5UuvLAGY5c+Cwt82RBmodY7Pr/Xro+NgJOeYxC0yrpLnDacCpagnvrUnDB5FtAzehwj8WpYZ8+c5/OL02wY2Y7oUXcs+cx61YMyDl1/OrTwH8AkyWCOE7md/NXpFqOHYD439kwU3vi+NUEAxBTBd6n1pxQEaVU9tccPf7DDJMJAAiUZPe4YMRTiVSasPv5sOVNEztUO');

// built: 2022-01-16T00:14:41.340Z
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
				try {
					// Attempt to convert the rest of the label to Unicode according to Punycode [RFC3492].
					// If that conversion fails, record that there was an error, and continue with the next label.
					let cps_decoded = puny_decode(cps.slice(4));
					// With either Transitional or Nontransitional Processing, sources already in Punycode are validated without mapping. 
					// In particular, Punycode containing Deviation characters, such as href="xn--fu-hia.de" (for fuß.de) is not remapped. 
					// This provides a mechanism allowing explicit use of Deviation characters even during a transition period. 
					[tokens] = tokenized_idna(cps_decoded, EMOJI_PARSER, cp => VALID.has(cp) ? [cp] : []);
					let expected = flatten_tokens(tokens);
					if (cps_decoded.length != expected.length || !cps_decoded.every((x, i) => x == expected[i])) throw new Error('not normalized');
					// Otherwise replace the original label in the string by the results of the conversion. 
					cps = cps_decoded;
					// warning: this could be empty
					// warning: this could be "**--"
				} catch (err) {
					throw label_error(cps, `punycode: ${err.message}`);
				}
			}
		}
		// flatten textual part of token to a single list of code-points
		let text = tokens.reduce((a, {v}) => {
			if (v) {
				a.push(...v);
			} else if (a.length > 0) { // emoji at the start of the label are deleted
				a.push(0xFE0F); // remaining emoji are replaced by FE0F (which is NSM) 
			}
			return a;
		}, []);
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
			/*CONTEXT*/
			try {
				validate_context(text); // this also does ContextO
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
