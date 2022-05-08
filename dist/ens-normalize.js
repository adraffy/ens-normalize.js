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
	// 0x22 (double-quote)
	// 0x7B/0x7D (curly-brace, used for escaping)
	// 0x7F (delete)
	return s.replace(/[^\x20-\x21\x23-\x7A\x7C\x7E]/gu, x => quote_cp(x.codePointAt(0)));
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

// built: 2022-05-08T07:17:49.345Z

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const STOP = 0x2E;
const KEYCAP_END = 0x20E3;

const VALID = read_member_set(r);
const IGNORED = read_member_set(r);
const MAPPED = read_mapped_table(r);
const COMBINING_MARKS = read_member_set(r);

const KEYCAP_LEGACY = read_member_set(r);
const KEYCAP_REQ = read_member_set(r);
const STYLE_LEGACY = read_member_set(r);
const STYLE_REQ = read_member_set(r);
const MODIFIER = read_member_set(r);
const MODIFIER_BASE = read_member_set(r);

// whitelisted SEQ and ZWJ sequences are stored as trees
// they can be traversed character by character 
// failing to find a subtree or a match (terminal node) 
// implies a failure match

// SEQ are 1-character chains
const SEQ_ROOT = read_tree(r, x => Array(x()).fill(1)); 

// ZWJ are variable-character chains 
// index into emoji for extra compression (bound asserted during build)
const ZWJ_ROOT = read_tree(r, read_zero_terminated_array, [...STYLE_LEGACY, ...STYLE_REQ].sort((a, b) => a - b));

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
const COMBINING_RANK = Array(r()).fill().map(() => read_member_set(r));
const DECOMP = read_mapped_table(r);
const COMP_EXCLUSIONS = read_member_set(r);

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

const VIRAMA = COMBINING_RANK[r()]; // index into virama class
const JOIN_T = read_member_set(r);
const JOIN_LD = read_member_set(r);
const JOIN_RD = read_member_set(r);
const SCRIPT_GREEK = read_member_set(r);
const SCRIPT_HEBREW = read_member_set(r);
const SCRIPT_HKH = read_member_set(r);

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
			throw new Error(`No context for ZWNJ`);
		} else if (cp === ZWJ) {
			// ZERO WIDTH JOINER (ZWJ)
			// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
			if (i > 0 && VIRAMA.has(cps[i-1])) return;
			throw new Error(`No context for ZWJ`);
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
			case 0x375: {
				// GREEK LOWER NUMERAL SIGN (KERAIA)
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.4
				// The script of the following character MUST be Greek.
				if (i < e && SCRIPT_GREEK.has(cps[i+1])) continue; 
				break;
			}
			case 0x5F3:
				// HEBREW PUNCTUATION GERESH
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.5
				// The script of the preceding character MUST be Hebrew.
			case 0x5F4: {
				// HEBREW PUNCTUATION GERSHAYIM
				// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.6		
				// The script of the preceding character MUST be Hebrew.
				if (i > 0 && SCRIPT_HEBREW.has(cps[i-1])) continue;
				break;
			}
			default: continue;
		}
		// the default behavior above is to continue if the context is valid
		// we only fall-through if no context was matched
		throw new Error(`No context for "${escape_unicode(FCP(cps[i]))}"`);
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
		throw new Error(`Disallowed arabic-indic digit mixture`);
	}
	// KATAKANA MIDDLE DOT
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.7
	// The effect of this rule is to require at least one character in the label to be in one of those scripts.
	// For All Characters: If Script(cp) .in. {Hiragana, Katakana, Han} Then True; End For;
	if (cps.includes(0x30FB) && !cps.some(cp => SCRIPT_HKH.has(cp))) {
		throw new Error(`Disallowed katakana`);
	}
}

// ************************************************************
// from bidi.js

const R_AL = read_member_set(r);
const L = read_member_set(r);
const AN = read_member_set(r);
const EN = read_member_set(r);
const ECTOB = read_member_set(r); // ES, CS, ET, ON, BN
const NSM = read_member_set(r);

function is_bidi_label(cps) {
	return cps.some(cp => R_AL.has(cp) || AN.has(cp));
}

function validate_bidi_label(cps) {
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

// ************************************************************

const FCP = String.fromCodePoint.bind(String);

// Primary API
// throws TypeError if not a string
// throws Error if not normalizable
// return string ready for namehash
function ens_normalize(name) {
	if (/^[0-9a-z\.\-]+$/i.test(name)) { // fast path
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
		for (let {e, v} of tokens) {
			if (v) {
				v = filter_contextJ(v); // ContextJ
				cps.push(...v);
				text.push(...v);
			} else {
				if (text.length > 0) { 
					// emoji at the start of the label are ignored until text is produced
					// afterwards, emoji are replaced by FE0F (which is NSM) 
					text.push(FE0F); 
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
		if (STOP == cp) return {};
		if (VALID.has(cp)) return [cp]; // this gets merged into v
		if (IGNORED.has(cp)) return {i: cp};
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; 
		return {d: cp};
	}, parse_emoji)[0];
}

function label_error(cps, message) {
	return new Error(`Disallowed label "${escape_unicode(FCP(...cps))}": ${message}`);
}

export { ens_normalize, ens_tokenize };
