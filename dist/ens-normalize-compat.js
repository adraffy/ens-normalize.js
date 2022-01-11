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

const BUILT = '2022-01-11T08:39:45.029Z';
const UNICODE = '14.0.0';
const VERSION = '1.3.10';
const IDNA = 'adraffy-compat';
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
		// emoji are replaced by FE0F (which is NSM) 
		let text = tokens.flatMap(({v}) => v ?? [0xFE0F]);
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

export { BUILT, IDNA, UNICODE, VERSION, ens_normalize, ens_tokenize };
