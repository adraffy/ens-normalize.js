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

var r$3 = read_compressed_payload('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');

const COMBINING_RANK = Array(r$3()).fill().map(() => read_member_set(r$3));
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

var r$2 = read_compressed_payload('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');

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

var r = read_compressed_payload('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');

const BUILT = '2022-01-16T00:14:41.340Z';
const UNICODE = '14.0.0';
const VERSION = '1.3.11';
const IDNA = 'adraffy-compat';
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
