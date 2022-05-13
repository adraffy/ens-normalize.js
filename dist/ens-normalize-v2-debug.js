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

function read_member_set(next, lookup) {
	let v = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < vN[i]; j++) {
			v.push(vX[i] + j);
		}
	}
	return new Set(lookup ? v.map(x => lookup[x]) : v);
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

var r = read_compressed_payload('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');

const BUILT = '2022-05-13T09:14:20.702Z';
const UNICODE = '14.0.0';
const VERSION = '1.4.1';
const NAME = 'adraffy+ss';

const FCP = String.fromCodePoint.bind(String);

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const STOP = 0x2E;
const KEYCAP_END = 0x20E3;

const VALID = read_member_set(r);
const SORTED_VALID = [...VALID].sort((a, b) => a - b);

const IGNORED = read_member_set(r);
const MAPPED = read_mapped_table(r);
const COMBINING_MARKS = read_member_set(r, SORTED_VALID);

const KEYCAP_LEGACY = read_member_set(r);
const KEYCAP_REQ = read_member_set(r);
const STYLE_LEGACY = read_member_set(r);
const STYLE_REQ = read_member_set(r);
const SORTED_EMOJI = [...STYLE_LEGACY, ...STYLE_REQ].sort((a, b) => a - b);

const MODIFIER = read_member_set(r, SORTED_EMOJI);
const MODIFIER_BASE = read_member_set(r, SORTED_EMOJI);

// whitelisted SEQ and ZWJ sequences are stored as trees
// they can be traversed character by character 
// failing to find a subtree or a match (terminal node) 
// implies a failure match

// SEQ are 1-character chains
const SEQ_ROOT = read_tree(r, x => Array(x()).fill(1)); 

// ZWJ are variable-character chains 
// index into emoji for extra compression (bound asserted during build)
const ZWJ_ROOT = read_tree(r, read_zero_terminated_array, SORTED_EMOJI);

const COMBINING_RANK = Array(r()).fill().map(() => read_member_set(r));
const DECOMP = read_mapped_table(r);
const COMP_EXCLUSIONS = read_member_set(r);

const VIRAMA = COMBINING_RANK[r()]; // index into virama class
const JOIN_T = read_member_set(r, SORTED_VALID);
const JOIN_LD = read_member_set(r, SORTED_VALID); // L
const JOIN_RD = read_member_set(r, SORTED_VALID); // R
for (let cp of read_member_set(r, SORTED_VALID)) { // D
	JOIN_LD.add(cp); // LD
	JOIN_RD.add(cp); // RD
}

//const SCRIPT_GREK = read_member_set(r, SORTED_VALID);
//const SCRIPT_HEBR = read_member_set(r, SORTED_VALID);
const SCRIPT_JPAN = read_member_set(r, SORTED_VALID);
const SCRIPT_LATN = read_member_set(r, SORTED_VALID);
const SCRIPT_HANB = read_member_set(r, SORTED_VALID);
const SCRIPT_KORE = read_member_set(r, SORTED_VALID);
const SCRIPT_ALL  = read_member_set(r, SORTED_VALID);


const SCRIPTS = [
	//SCRIPT_GREK,
	//SCRIPT_HEBR,
	SCRIPT_JPAN,
	SCRIPT_LATN,
	SCRIPT_HANB,
	SCRIPT_KORE,
	/*
	https://www.unicode.org/reports/tr39/#highly_restrictive
	The string is covered by any of the following sets of scripts, according to the definition in Section 5.1: 
	Latin + Han + Hiragana + Katakana; or equivalently: Latn + Jpan
	Latin + Han + Bopomofo; or equivalently: Latn + Hanb
	Latin + Han + Hangul; or equivalently: Latn + Kore
	*/
	new Set([...SCRIPT_LATN, ...SCRIPT_JPAN]),
	new Set([...SCRIPT_LATN, ...SCRIPT_HANB]),
	new Set([...SCRIPT_LATN, ...SCRIPT_KORE])
];

while (true) {
	let set = read_member_set(r, SORTED_VALID);
	if (set.size == 0) break;
	SCRIPTS.push(set);
}

const R_AL = read_member_set(r, SORTED_VALID);
const L = read_member_set(r, SORTED_VALID);
const AN = read_member_set(r, SORTED_VALID);
const EN = read_member_set(r, SORTED_VALID);
const ECTOB = read_member_set(r, SORTED_VALID); 
const NSM = read_member_set(r, SORTED_VALID);
const NSM0 = NSM.values().next().value;

// ************************************************************

// trees are stored as nested objects
// "abc" => {a:{b:{c:{'':1}}}}
// empty string is a match (terminal node)
function has_own(obj, key = '') {
	return Object.hasOwn(obj, key);
}

// trees are traversed by string keys 
// composed of flattened codepoints 
// without emoji styling
function follow_zwj(parent, cps) {
	let key = FCP(...cps.filter(cp => cp != FE0F));
	if (has_own(parent, key)) return parent[key];
}

// https://unicode.org/reports/tr51/#def_emoji_modifier 
// emoji_modifier_base := \p{Emoji_Modifier_Base}
// emoji_modifier := \p{Emoji_Modifier}
// emoji_modifier_sequence := emoji_modifier_base emoji_modifier

// https://unicode.org/reports/tr51/#def_emoji_character
// emoji_character := \p{Emoji}
// emoji_presentation_selector := \x{FE0F}
// emoji_presentation_sequence := emoji_character emoji_presentation_selector

// read a single modifier or presentation sequence
// if found, return [consumed_length, parsed_codepoints]
// note: build-tables.js asserts that MODIFIER_BASE and MODIFIER are style-drop
function find_emoji_chr_mod_pre(cps, pos) {
	let a = cps[pos];
	if (!a) return;
	let b = cps[pos+1];
	if (MODIFIER_BASE.has(a) && MODIFIER.has(b)) return [2, [a, b]]; // modifier sequence
	if (STYLE_LEGACY.has(a)) return [b === FE0F ? 2 : 1, [a]]; // style is optional but dropped
	if (STYLE_REQ.has(a) && b === FE0F) return [2, [a, FE0F]]; // style is required
}

/*
// this is an alternative implementation
// which allows styling around modifier sequences

// read a single emoji character
// if found, return [consumed_length, parsed_codepoints]
function find_emoji_styled(cps, pos) {
	let cp = cps[pos];
	if (!cp) return;
	let styled = cps[pos+1] === FE0F;
	if (STYLE_LEGACY.has(cp)) return [styled ? 2 : 1, [cp]]; // style is optional but dropped
	if (STYLE_REQ.has(cp) && styled) return [2, [cp, FE0F]]; // style is required
}

// read a single modifier or presentation sequence
// if found, return [consumed_length, parsed_codepoints]
function find_emoji_chr_mod_pre(cps, pos) {
	let a = find_emoji_styled(cps, pos);
	if (a && MODIFIER_BASE.has(a[1][0])) { // could be emoji_modifier_sequence...
		let b = find_emoji_styled(cps, pos + a[0]);
		if (b && MODIFIER.has(b[1][0])) {
			return [a[0] + b[0], [...a[1], ...b[1]]]; // concat
		}
	}
	return a;
}
*/

// read a complex emoji
// always returns [consumed_length, parsed_codepoints?]
function parse_emoji(cps, pos0) {
	let cp0 = cps[pos0];

	// check for SEQ match
	let seq_key = FCP(cp0);
	if (has_own(SEQ_ROOT, seq_key)) { // potential match
		let node = SEQ_ROOT[seq_key];
		let pos = pos0 + 1; // check remaining chars
		while (true) {
			let cp = cps[pos];
			if (!cp) break; // end of string
			let key = FCP(cp);
			if (!has_own(node, key)) break; // no more possibilities
			node = node[key];
			pos++;
		}
		if (has_own(node)) { // this was a terminator
			return [pos - pos0, cps.slice(pos0, pos)];
		}
	}

	let cp1 = cps[pos0+1];
	
	// emoji flag sequence
	// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
	// regional_indicator := \p{Regional_Indicator}
	// emoji_flag_sequence := regional_indicator regional_indicator  
	// *** NOT PROCESSED *** 
	// instead single regional_indicator are allowed (they are just emoji)
	
	// emoji keycap sequence
	// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
	// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
	let keycap_og = KEYCAP_LEGACY.has(cp0);
	if (keycap_og && cp1 === KEYCAP_END) {
		return [2, [cp0, KEYCAP_END]];
	} else if ((keycap_og || KEYCAP_REQ.has(cp0)) && cp1 === FE0F && cps[pos0+2] === KEYCAP_END) {
		return [3, keycap_og ? [cp0, KEYCAP_END] : [cp0, FE0F, KEYCAP_END]];		
	}

	// emoji core sequence
	// https://unicode.org/reports/tr51/#def_emoji_core_sequence 
	// emoji_core_sequence := emoji_keycap_sequence | emoji_flag_sequence | chr_mod_pre
	// chr_mod_pre = emoji_character | emoji_presentation_sequence | emoji_modifier_sequence
	let emoji0 = find_emoji_chr_mod_pre(cps, pos0); 
	if (!emoji0) return [0];

	// emoji sequence 
	// https://unicode.org/reports/tr51/#def_emoji_sequence
	// emoji_sequence := chr_mod_pre | emoji_zwj_sequence | emoji_tag_sequence 
	
	// https://unicode.org/reports/tr51/#def_emoji_zwj_sequence
	// emoji_zwj_element := emoji_character | emoji_presentation_sequence | emoji_modifier_sequence		
	// emoji_zwj_sequence := emoji_zwj_element ( \x{200d} emoji_zwj_element )+		
		
	let [n0, v0] = emoji0;
	let pos1 = pos0 + n0;
	cp1 = cps[pos1]; // the character following the emoji we just parsed
	if (cp1 === ZWJ) { // potential match
		let node = follow_zwj(ZWJ_ROOT, v0); 
		if (node) { // whitelisted
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
				queue.push(ZWJ, ...v); // save chars that dont form a complete sequence yet
				if (has_own(node)) { // this is a valid sequence
					v0.push(...queue); // drain queue
					queue.length = 0;
					pos_last = pos;
				}
			}
			if (pos_last) {
				// v0 correponds to the longest zwj sequence that matched
				return [pos_last - pos0, v0];
			}
		}
	}

	// emoji tag sequence
	// https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence
	// emoji_tag_sequence := tag_base tag_spec tag_end
	// tag_base := emoji_character 
	//           | emoji_modifier_sequence     => emoji_modifier_base emoji_modifier
	//           | emoji_presentation_sequence => emoji_character \x{FE0F}
	// tag_spec := [\x{E0020}-\x{E007E}]+
	// tag_end  := \x{E007F}		
	// *** NOT PROCESSED *** 
	// these are allowed via SEQ

	return emoji0;
}

// ************************************************************
// from nf.js

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

// ************************************************************
// from context.js

// apply ContextJ filtering
function filter_contextJ(cps) {
	return cps.filter((cp, i) => {
		if (cp === 0x200C) {
			// ZERO WIDTH NON-JOINER (ZWNJ)
			// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1	
			// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
			if (i > 0 && VIRAMA.has(cps[i - 1])) return;
			// If RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D})) Then True;
			let e = cps.length - 1;
			if (i > 0 && i < e) { // there is room on either side
				let head = i - 1;
				while (head > 0 && JOIN_T.has(cps[head])) head--; // T*
				if (JOIN_LD.has(cps[head])) { // L or D
					let tail = i + 1;
					while (tail < e && JOIN_T.has(cps[tail])) tail++; // T*
					if (JOIN_RD.has(cps[tail])) { // R or D
						return;
					}
				}
			}
			throw new Error(`no context for ZWNJ`);
		} else if (cp === ZWJ) {
			// ZERO WIDTH JOINER (ZWJ)
			// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
			if (i > 0 && VIRAMA.has(cps[i-1])) return;
			throw new Error(`no context for ZWJ`);
		}
		return true;
	});
}

// apply ContextO rules
function validate_contextO(cps) {
	for (let i = 0, e = cps.length - 1; i <= e; i++) {
		switch (cps[i]) {			
			case 0xB7: {
				// MIDDLE DOT
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
				// Between 'l' (U+006C) characters only, used to permit the Catalan
				// character ela geminada to be expressed.
				if (i > 0 && i < e && cps[i-1] == 0x6C && cps[i+1] == 0x6C) continue; 
				break;
			}
			/*
			// [not possible with single-script]
			// see: assert_isolated('Grek')
			case 0x375: {
				// GREEK LOWER NUMERAL SIGN (KERAIA)
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.4
				// The script of the following character MUST be Greek.
				if (i < e && SCRIPT_GREK.has(cps[i+1])) continue; 
				break;
			}
			*/
			/*
			// [not possible with single-script]
			// see: assert_isolated('Hebr')
			case 0x5F3:
				// HEBREW PUNCTUATION GERESH
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.5
				// The script of the preceding character MUST be Hebrew.
			case 0x5F4: {
				// HEBREW PUNCTUATION GERSHAYIM
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.6		
				// The script of the preceding character MUST be Hebrew.
				if (i > 0 && SCRIPT_HEBR.has(cps[i-1])) continue;
				break;
			}
			*/
			default: continue;
		}
		// the default behavior above is to continue if the context is valid
		// we only fall-through if no context was matched
		throw new Error(`no context for "${escape_unicode(FCP(cps[i]))}"`);
	}
	// ARABIC-INDIC DIGITS
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.8
	// Can not be mixed with Extended Arabic-Indic Digits.
	// For All Characters: If cp .in. 06F0..06F9 Then False; End For;
	// EXTENDED ARABIC-INDIC DIGITS
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.9
	// Can not be mixed with Arabic-Indic Digits.
	// For All Characters: If cp .in. 0660..0669 Then False; End For
	if (cps.some(cp => cp >= 0x660 && cp <= 0x669) && cps.some(cp => cp >= 0x6F0 && cp <= 0x6F9)) {
		throw new Error(`arabic-indic digit mixture`);
	}
	/*
	// [not possible with single-script]
	// KATAKANA MIDDLE DOT
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.7
	// The effect of this rule is to require at least one character in the label to be in one of those scripts.
	// For All Characters: If Script(cp) .in. {Hiragana, Katakana, Han} Then True; End For;
	if (cps.includes(0x30FB) && !cps.some(cp => SCRIPT_JPAN.has(cp))) {
		throw new Error(`katakana`);
	}
	*/
}

// ************************************************************
// from bidi.js

function is_bidi_label(cps) {
	return cps.some(cp => R_AL.has(cp) || AN.has(cp));
}

function validate_bidi_label(cps) {
	// https://datatracker.ietf.org/doc/html/rfc5893
	// 1.) The first character must be a character with Bidi property L, R, 
	// or AL.  If it has the R or AL property, it is an RTL label; if it
	// has the L property, it is an LTR label.
	let last = cps.length - 1;
	if (R_AL.has(cps[0])) { // RTL 
		// 2.) In an RTL label, only characters with the Bidi properties R, AL, AN, EN, ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => R_AL.has(cp) || AN.has(cp) || EN.has(cp) || ECTOB.has(cp) || NSM.has(cp))) throw new Error(`RTL (properties)`);
		// 3. In an RTL label, the end of the label must be a character with
		// Bidi property R, AL, EN, or AN, followed by zero or more
		// characters with Bidi property NSM.
		while (NSM.has(cps[last])) last--;
		last = cps[last];
		if (!(R_AL.has(last) || EN.has(last) || AN.has(last))) throw new Error(`RTL (ending)`);
		// 4. In an RTL label, if an EN is present, no AN may be present, and vice versa.
		if (cps.some(cp => EN.has(cp)) && cps.some(cp => AN.has(cp))) throw new Error(`RTL (exclusion)`);
	} else if (L.has(cps[0])) { // LTR
		// 5. In an LTR label, only characters with the Bidi properties L, EN, ES, CS, ET, ON, BN, or NSM are allowed.
		if (!cps.every(cp => L.has(cp) || EN.has(cp) || ECTOB.has(cp) || NSM.has(cp))) throw new Error(`LTR (properties)`);
		// 6. end with L or EN .. 0+ NSM
		while (NSM.has(cps[last])) last--;
		last = cps[last];
		if (!L.has(last) && !EN.has(last)) throw new Error(`LTR (ending)`);
	} else if (cps.every(cp => AN.has(cp))) ; else {
		throw new Error(`unknown direction`);
	}
}


// ************************************************************

// Primary API
// throws TypeError if not a string
// throws Error if not normalizable
// return string ready for namehash
function ens_normalize(name) {
	if (/^[0-9a-z\.\-]+$/iu.test(name)) { // fast path
		return name.toLowerCase();
	}
	let labels = parse_tokens(nfc(explode_cp(name)), cp => {
		if (STOP == cp) return; // create a new label
		if (IGNORED.has(cp)) return []; // 0 char
		if (VALID.has(cp)) return [cp]; // 1 char
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return mapped; // 1+ chars
		throw new Error(`Disallowed character "${escape_unicode(FCP(cp))}"`);
	}, parse_emoji).map(tokens => {
		let cps = []; // output code points
		let text = []; // textual code points
		let scripts; // script universe
		for (let {e, v} of tokens) {
			if (v) {
				try {
					v = filter_contextJ(v); // ContextJ
				} catch (err) {
					throw label_error(cps, err.message);
				}
				cps.push(...v);
				text.push(...v);
				// https://www.unicode.org/reports/tr39/#Mixed_Script_Detection
				for (let cp of v) {
					if (SCRIPT_ALL.has(cp)) continue;
					if (scripts) {
						scripts = scripts.filter(i => SCRIPTS[i].has(cp));
						if (scripts.length == 0) {
							throw label_error(cps, `not single script`);
						}
					} else {
						scripts = [];
						for (let i = 0; i < SCRIPTS.length; i++) {
							if (SCRIPTS[i].has(cp)) {
								scripts.push(i);
							}
						}
					}
					//console.log(cp, scripts);
				}
			} else {
				if (text.length > 0) { 
					// emoji at the start of the label are ignored until text is produced
					// afterwards, emoji are replaced by an NSM placeholder
					// (acts like a separator)
					text.push(NSM0); 
				}
				cps.push(...e);
			}
		}
		return {text, cps};
	});
	// https://unicode.org/reports/tr46/#Notation
	// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN
	let check_bidi = labels.some(x => is_bidi_label(x.text));
	return labels.map(({cps, text}) => {
		if (cps.length > 0) {
			if (COMBINING_MARKS.has(cps[0])) {
				throw label_error(cps, `leading combining mark`);
			}
			try {
				validate_contextO(text); // ContextO
				if (check_bidi) {
					validate_bidi_label(text); // CheckBidi
				}
			} catch (err) {
				throw label_error(cps, err.message);
			}
		}
		return FCP(...cps);
	}).join(FCP(STOP));
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R💩affy.eth"
// this is much nicer than exposing the predicates
// [{m:[0x72], u:[0x52]},{e:[0x1F4A9],u:[0x1F4A9]},{t:[61,66,66]},{},{t:[65,74,68]}]
function ens_tokenize(name) {
	return parse_tokens(nfc(explode_cp(name)), cp => {
		if (STOP == cp) return {}; // stop 
		if (VALID.has(cp)) return [cp]; // this gets merged into v
		if (IGNORED.has(cp)) return {i: cp}; // ignored 
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; // mapped (u = before)
		return {d: cp}; // disallowed
	}, parse_emoji)[0]; // emoji (u = before)
}

function label_error(cps, message) {
	return new Error(`Disallowed label "${escape_unicode(FCP(...cps))}": ${message}`);
}

export { BUILT, NAME, UNICODE, VERSION, ens_normalize, ens_tokenize };
