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
	// 0x22 (double-quote)
	// 0x7B/0x7D (curly-brace, used for escaping)
	// 0x7F (delete)
	return s.replace(/[^\x20-\x21\x23-\x7A\x7C\x7E]/gu, x => quote_cp(x.codePointAt(0)));
}

function escape_name_for_html(s, quoter) {
	// printable w/o:
	// html: 0x26 &, 0x3C <, 0x3E >
	// quote: 0x00-0x20 control, 0x7F DEL, whitespace, joiners, tagspec
	if (!quoter) quoter = quote_cp;
	return s.replace(/(?:([\x00-\x20\x7F\xA0\s\u200C\u200D\u{E0020}-\u{E007F}])|([^\x21-\x25\x27-\x3B\x3D\x3F-\x7E]))/gu, 
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

var PAYLOAD = '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';

// this is a polyfill for normalized forms
// it exists because the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
// but lib-nf.js is approx 13KB as of 20211221

function norm(form, cps) {
	return explode_cp(String.fromCodePoint(...cps).normalize(form));
}

function nfc(cps) { return norm('NFC', cps); }
function nfd(cps) { return norm('NFD', cps); }

const BUILT = '2022-01-12T22:50:27.708Z';
const UNICODE = '14.0.0';
const VERSION = '1.3.11';
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
