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
		read_deltas(n, next).forEach((x, j) => m[j].push(lookup ? lookup(x) : x));
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

var next = read_compressed_payload('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');

const BUILT = '2022-05-29T05:51:51.717Z';
const UNICODE = '14.0.0';
const VERSION = '1.4.3';
const NAME = 'adraffy+ss';

const FCP = String.fromCodePoint.bind(String);

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const STOP = 0x2E;
const KEYCAP_END = 0x20E3;

const VALID = read_member_set(next);
const SORTED_VALID = [...VALID].sort((a, b) => a - b);

const IGNORED = read_member_set(next);
const MAPPED = read_mapped_table(next);

const COMBINING_MARKS = read_member_set(next, SORTED_VALID);

const KEYCAP_LEGACY = read_member_set(next);
const KEYCAP_REQ = read_member_set(next);
const STYLE_LEGACY = read_member_set(next);
const STYLE_REQ = read_member_set(next);
const SORTED_EMOJI = [...STYLE_LEGACY, ...STYLE_REQ].sort((a, b) => a - b);

const MODIFIER = read_member_set(next, SORTED_EMOJI);
const MODIFIER_BASE = read_member_set(next, SORTED_EMOJI);

// whitelisted SEQ and ZWJ sequences are stored as trees
// they can be traversed character by character 
// failing to find a subtree or a match (terminal node) 
// implies a failure match

// SEQ are 1-character chains
const SEQ_ROOT = read_tree(next, x => Array(x()).fill(1)); 

// ZWJ are variable-character chains 
// index into emoji for extra compression (bound asserted during build)
const ZWJ_ROOT = read_tree(next, read_zero_terminated_array, x => SORTED_EMOJI[x]);

const COMBINING_RANK = Array(next()).fill().map(() => read_member_set(next));
const DECOMP = read_mapped_table(next);
const COMP_EXCLUSIONS = read_member_set(next);

const VIRAMA = COMBINING_RANK[next()]; // index into virama class
const JOIN_T = read_member_set(next, SORTED_VALID);
const JOIN_LD = read_member_set(next, SORTED_VALID);
const JOIN_RD = read_member_set(next, SORTED_VALID); 

const SCRIPTS = Array(next()).fill().map(() => read_member_set(next, SORTED_VALID));
while (true) {
	let i = next();
	if (!i) break;
	for (let j of read_member_set(next)) {
		SCRIPTS[j] = new Set([...SCRIPTS[i-1], ...SCRIPTS[j]]);
	} 
}
const [SCRIPT_ALL, SCRIPT_JPAN/*, SCRIPT_GREK, SCRIPT_HEBR*/] = SCRIPTS;

const WHOLE_ROOT = read_tree(next, x => Array(x()).fill(1), x => SORTED_VALID[x]);
read_tree(next, x => Array(x()).fill(1), x => SORTED_VALID[x]);
const CONFUSE_SCRIPT_ROOTS = SCRIPTS.map(() => read_tree(next, x => Array(x()).fill(1), x => SORTED_VALID[x]));

const R_AL = read_member_set(next, SORTED_VALID);
const L = read_member_set(next, SORTED_VALID);
const AN = read_member_set(next, SORTED_VALID);
const EN = read_member_set(next, SORTED_VALID);
const ECTOB = read_member_set(next, SORTED_VALID); 
const NSM = read_member_set(next, SORTED_VALID);

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

function find_seq_match(root, cps, pos0) {
	let seq_key = FCP(cps[pos0]);
	if (has_own(root, seq_key)) { // potential match
		let node = root[seq_key];
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
			return pos; 
		}
	}
}

// read a complex emoji
// always returns [consumed_length, parsed_codepoints?]
function parse_emoji(cps, pos0) {
	
	let pos = find_seq_match(SEQ_ROOT, cps, pos0);
	if (pos) {
		return [pos - pos0, cps.slice(pos0, pos)];
	}


	/*
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
	*/

	let cp0 = cps[pos0];
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
	/*
	// [mapped to arabic]
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
	*/
	// [almost not possible with single script, counter example: aa{30FB}]	
	// KATAKANA MIDDLE DOT
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.7
	// The effect of this rule is to require at least one character in the label to be in one of those scripts.
	// For All Characters: If Script(cp) .in. {Hiragana, Katakana, Han} Then True; End For;
	const KATAKANA_MIDDLE_DOT = 0x30FB;
	if (cps.includes(KATAKANA_MIDDLE_DOT) && !cps.some(cp => cp != KATAKANA_MIDDLE_DOT && SCRIPT_JPAN.has(cp))) {
		throw new Error(`katakana`);
	}
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
	let labels = parse_tokens(explode_cp(name), cp => {
		if (STOP == cp) return; // create a new label
		if (IGNORED.has(cp)) return []; // 0 char
		if (VALID.has(cp)) return [cp]; // 1 char
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return mapped; // 1+ chars
		throw new Error(`Disallowed character "${escape_unicode(FCP(cp))}"`);
	}, parse_emoji).map(tokens => {
		let cps = []; // output code points
		let text = []; // textual code points
		let whole = true;
		let scripts; // script universe
		for (let {e, v} of tokens) {
			if (v) {
				try {
					v = filter_contextJ(nfc(v)); 
				} catch (err) {
					throw label_error(cps, err.message);
				}
				if (!v.length) continue;
				if (COMBINING_MARKS.has(cps[0])) {
					throw label_error(cps, `leading combining mark`);
				}
				cps.push(...v);
				if (text.length) text.push(0x20); // space
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
						scripts = SCRIPTS.reduce((acc, set, i) => {
							if (set.has(cp)) acc.push(i);
							return acc;
						}, []);
					}
				}
				if (whole) {
					let off = 0;
					while (off < v.length) {
						let pos = find_seq_match(WHOLE_ROOT, v, off);
						if (!pos) {
							whole = false;
							break;
						}
						off = pos;
					}
				}
			} else {
				cps.push(...e);
			}
		}
		if (text.length) {
			try {
				validate_contextO(text); 
			} catch (err) {
				throw label_error(cps, err.message);
			}
			if (whole) {
				throw label_error(cps, `whole script confusing`);
			}
			if (scripts) {
				for (let j of scripts) {
					for (let i = 0; i < text.length; i++) {
						if (find_seq_match(CONFUSE_SCRIPT_ROOTS[j], text, i)) {
							throw label_error(cps, `confusing "${escape_unicode(FCP(text[i]))}"`);
						}
					}
				}
			}
		}
		return {text, cps};
	});
	// https://unicode.org/reports/tr46/#Notation
	// A Bidi domain name is a domain name containing at least one character with BIDI_Class R, AL, or AN
	if (labels.some(x => is_bidi_label(x.text))) {
		for (let {cps, text} of labels) {
			try {
				validate_bidi_label(text); // CheckBidi
			} catch (err) {
				throw label_error(cps, err.message);
			}
		}
	}
	return labels.map(x => FCP(...x.cps)).join(FCP(STOP));
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R💩affy.eth"
// this is much nicer than exposing the predicates
// [{m:[0x72], u:[0x52]},{e:[0x1F4A9],u:[0x1F4A9]},{t:[61,66,66]},{},{t:[65,74,68]}]
function ens_tokenize(name) {
	for (let cp of explode_cp(name)) {
		if (STOP === cp) ; else if (VALID.has(cp)) ;

	}



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
