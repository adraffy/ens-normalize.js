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

/*
export function read_payload(v) {
	let pos = 0;
	let r = () => v[pos++];
	r.more = () => pos < v.length;
	return r;
}
*/

// returns an iterator which returns the next symbol
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
	// 0x20 (space)
	// 0x22 (double-quote)
	// 0x7B/0x7D (curly-brace, used for escaping)
	// 0x7F (delete)
	return s.replace(/[^\x21\x23-\x7A\x7C\x7E]/gu, x => quote_cp(x.codePointAt(0)));
}

// str to cps
function explode_cp(s) {
	if (typeof s != 'string') throw new TypeError(`expected string`);	
	return [...s].map(c => c.codePointAt(0));
}

// returns list of lists
// returns [[]] if empty

// tokenizer: (cp) -> array or object (token)
// different tokenizers can produce other tokens

// (optional) emoji_parser: (cps, pos) -> [len, cps]

// default tokens:
// emoji: {e:[],u:[]} where e = cps, u = input
// valid: {v:[]}      where v = cps

function parse_tokens(cps, tokenizer, emoji_parser) {
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

// https://datatracker.ietf.org/doc/html/rfc3492

// formats:
// "{encoded}"
// "{lower-ascii}-{encoded}"

// overflow calculation:
// https://datatracker.ietf.org/doc/html/rfc3492#section-6.4
// max unicode = 0x10FFFF => 21 bits
// max safe int = 53 bits (same as string length)
// (32 - 21) => 11-bit label length => 2KB unsigned
// (53 - 21) => 32-bit label length => 4GB unsigned
// decision: use IEEE-754 math, ignore bounds check

// Bootstring for Punycode
// https://datatracker.ietf.org/doc/html/rfc3492#section-5
const BASE = 36; 
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const N = 128;
const BIAS = 72;

const SHIFT_BASE = BASE - T_MIN;
const MAX_DELTA = SHIFT_BASE * T_MAX >> 1;

const HYPHEN = 0x2D;

// A decoder MUST recognize the letters in both uppercase and lowercase
// forms (including mixtures of both forms).
function basic_from_cp(cp) {
	if (cp >= 48 && cp <= 57) { // 0-9
		return cp - 22; 
	} else if (cp >= 97 && cp <= 122) { // a-z
		return cp - 97;
	} else if (cp >= 65 && cp <= 90) { // A-Z 
		return cp - 65;
	} else {
		throw new Error(`Expected basic character: ${cp}`);
	}
}

function trim_bias(k, bias) {
	let delta = k - bias;
	return delta <= 0 ? T_MIN : delta >= T_MAX ? T_MAX : delta;
}

// https://datatracker.ietf.org/doc/html/rfc3492#section-6.1
function adapt(delta, n, first) {
	delta = Math.floor(delta / (first ? DAMP : 2));
	delta += Math.floor(delta / n);
	let k = 0;
	while (delta > MAX_DELTA) {
		delta = Math.floor(delta / SHIFT_BASE);
		k += BASE;
	}
	return k + Math.floor((1 + SHIFT_BASE) * delta / (delta + SKEW));
}

// https://datatracker.ietf.org/doc/html/rfc3492#section-6.2
// cps -> cps
// assumes "xn--" prefix is already removed
// does not restrict ascii part
function puny_decode(cps) {
	let ret = [];
	let pos = cps.lastIndexOf(HYPHEN);
	for (let i = 0; i < pos; i++) {
		let cp = cps[i];
		if (cp >= N) throw new Error('Expected ASCII');
		ret.push(cp);
	}
	pos++; // skip hyphen
	let i = 0, n = N, bias = BIAS;
	while (pos < cps.length) {
		let prev = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (pos >= cps.length) throw new Error(`Invalid Encoding`);
			let basic = basic_from_cp(cps[pos++]);
			i += basic * w;
			let t = trim_bias(k, bias);
			if (basic < t) break;
			w *= BASE - t;
		}
		let len = ret.length + 1;
		bias = adapt(i - prev, len, prev == 0);
		n += Math.floor(i / len);
		i %= len;
		ret.splice(i++, 0, n);
	}	
	return ret;
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

var r = read_compressed_payload('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');

const BUILT = '2022-05-11T04:26:58.675Z';
const UNICODE = '14.0.0';
const VERSION = '1.3.17';
const NAME = 'ENS0';
const STOP = read_member_set(r);
const VALID = read_member_set(r);
const IGNORED = read_member_set(r);
const MAPPED = read_mapped_table(r);
const COMBINING_MARKS = read_member_set(r);
const EMOJI_PARSER = r() && emoji_parser_factory(r); // this is optional

// collapse emoji or NFC(text) to code points
function flatten_tokens(tokens) {
	return tokens.flatMap(({e, v}) => e ?? v);
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
	let labels = parse_tokens(nfc(explode_cp(name)), cp => {
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
	}, EMOJI_PARSER).map(tokens => {
		let cps = flatten_tokens(tokens);
		// [Processing] 4.) Convert/Validate
		if (cps.length >= 4 && cps[0] == 0x78 && cps[1] == 0x6E && cps[2] == HYPHEN && cps[3] == HYPHEN) { // "xn--"
			try {
				// Attempt to convert the rest of the label to Unicode according to Punycode [RFC3492].
				// https://www.rfc-editor.org/rfc/rfc3492.html
				// If that conversion fails, record that there was an error, and continue with the next label.
				let cps_decoded = puny_decode(cps.slice(4));
				// With either Transitional or Nontransitional Processing, sources already in Punycode are validated without mapping. 
				// In particular, Punycode containing Deviation characters, such as href="xn--fu-hia.de" (for fu??.de) is not remapped. 
				// This provides a mechanism allowing explicit use of Deviation characters even during a transition period. 
				tokens = parse_tokens(nfc(cps_decoded), cp => VALID.has(cp) ? [cp] : [])[0];
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
		// flatten textual part of label into a single list of code-points
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
			// => satsified by nfc() via flatten_tokens()
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
			
			// [Validity] 8.) see below
		}
		return {/*tokens,*/ cps, text};
	});
	// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
	// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
	
	return labels.map(x => String.fromCodePoint(...x.cps)).join('.');
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R????affy.eth"
// this is much nicer than exposing the predicates
// [{m:[0x72], u:[0x52]},{e:[0x1F4A9],u:[0x1F4A9]},{t:[61,66,66]},{},{t:[65,74,68]}]
function ens_tokenize(name) {
	return parse_tokens(explode_cp(name), cp => {
		if (STOP.has(cp)) return {};
		if (VALID.has(cp)) return [cp]; // this gets merged into v
		if (IGNORED.has(cp)) return {i: cp};
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; 
		return {d: cp};
	}, EMOJI_PARSER)[0];
}

export { BUILT, NAME, UNICODE, VERSION, ens_normalize, ens_tokenize };
