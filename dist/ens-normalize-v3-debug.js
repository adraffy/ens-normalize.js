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

function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

// str to cps
function explode_cp(s) {
	if (typeof s != 'string') throw new TypeError(`expected string`);	
	return [...s].map(c => c.codePointAt(0));
}

var next = read_compressed_payload('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');

const BUILT = '2022-06-26T23:10:09.754Z';
const UNICODE = '14.0.0';
const VERSION = '1.4.4';
const NAME = 'adraffy3';

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const STOP = 0x2E;
const KEYCAP_END = 0x20E3;

const VALID = read_member_set(next);
const IGNORED = read_member_set(next);
const MAPPED = read_mapped_table(next);

const KEYCAP = read_member_set(next);
const STYLE = read_member_set(next);
const SORTED_STYLE = [...STYLE].sort((a, b) => a - b);
const MODIFIER_BASE = read_member_set(next, SORTED_STYLE);
const MODIFIER = read_member_set(next, SORTED_STYLE);


const SEQ_ROOT = read_tree(next, x => Array(x()).fill(1)); 
const ZWJ_ROOT = read_tree(next, read_zero_terminated_array, x => SORTED_STYLE[x]);

const COMBINING_RANK = Array(next()).fill().map(() => read_member_set(next));
const DECOMP = read_mapped_table(next);
const COMP_EXCLUSIONS = read_member_set(next);

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
	let key = String.fromCodePoint(...cps.filter(cp => cp != FE0F));
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
	if (STYLE.has(a)) return [b === FE0F ? 2 : 1, [a]]; // FE0F is optional
}

function find_seq_match(root, cps, pos0) {
	let seq_key = String.fromCodePoint(cps[pos0]);
	if (has_own(root, seq_key)) { // potential match
		let node = root[seq_key];
		let pos = pos0 + 1; // check remaining chars
		while (true) {
			let cp = cps[pos];
			if (!cp) break; // end of string
			let key = String.fromCodePoint(cp);
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
	if (KEYCAP.has(cp0)) {
		if (cp1 === KEYCAP_END) return [2, [cp0, KEYCAP_END]];
		if (cp1 === FE0F && cps[pos0+2] === KEYCAP_END) return [3, [cp0, KEYCAP_END]];
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

function parse_tokens(cps, tokenizer) {
	let chars = [];
	let tokens = [];
	function drain() { 
		if (chars.length > 0) {
			tokens.push({v: chars}); 
			chars = [];
		}
	}
	for (let i = 0; i < cps.length; i++) {
		let [len, e] = parse_emoji(cps, i);
		if (len > 0) {
			drain();
			tokens.push({e, u:cps.slice(i, i+len)}); // these are emoji tokens
			i += len - 1;
			continue;
		}
		let cp = cps[i];
		let token = tokenizer(cp);
		if (Array.isArray(token)) { // this is more characters
			chars.push(...token);
		} else {
			drain();
			tokens.push(token);
		}
	}
	drain();
	return tokens;
}

// Primary API
// throws TypeError if not a string
// throws Error if not normalizable
// return string ready for namehash
function ens_normalize(name) {
	if (/^[0-9a-z\.\-]+$/iu.test(name)) { // fast path
		return name.toLowerCase();
	}
	return String.fromCodePoint(...parse_tokens(explode_cp(name), cp => {
		if (STOP === cp) return {}; // stop
		if (IGNORED.has(cp)) return []; // 0 char
		if (VALID.has(cp)) return [cp]; // 1 char
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return mapped; // 1+ chars
		throw new Error(`Disallowed character 0x${cp.toString(16)}`);
	}).flatMap(({e, v}) => e ? e : v ? nfc(v) : STOP));
}

// Secondary API
// throws TypeError if not a string
// turns a name into tokens: eg. "R💩affy.eth"
// this is much nicer than exposing the predicates
// [{m:[0x72], u:[0x52]},{e:[0x1F4A9],u:[0x1F4A9]},{t:[61,66,66]},{},{t:[65,74,68]}]
function ens_tokenize(name) {
	let tokens = parse_tokens(explode_cp(name), cp => {
		if (STOP == cp) return {}; // stop 
		if (VALID.has(cp)) return [cp]; // merge into v
		if (IGNORED.has(cp)) return {i: cp}; // ignored 
		let mapped = lookup_mapped(MAPPED, cp);
		if (mapped) return {m: mapped, u: [cp]}; // mapped (u = before)
		return {d: cp}; // disallowed
	});
	function could_transform(t) {
		return t.v || t.m || t.i;
	}
	let i = 0;
	while (i < tokens.length) {
		if (!could_transform(tokens[i])) {
			i++;
			continue;
		}
		let j = i + 1;
		while (j < tokens.length && could_transform(tokens[j])) j++;
		let u = tokens.slice(i, j);
		let cps0 = u.flatMap(({v, m}) => v ?? m ?? []);
		let cps1 = nfc(cps0);
		if (compare_arrays(cps0, cps1) == 0) {
			i = j;
			continue;
		}
		tokens.splice(i, j - i, {n: cps1, u});
		i++;
	}
	return tokens;
}

export { BUILT, NAME, UNICODE, VERSION, ens_normalize, ens_tokenize };
