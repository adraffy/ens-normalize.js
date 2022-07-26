import {read_member_set, read_mapped_table, lookup_mapped, read_tree, read_zero_terminated_array} from './decoder.js';
import {compare_arrays, explode_cp} from './utils.js';
import next from './output/v3.js';

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
export function ens_normalize(name) {
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
export function ens_tokenize(name) {
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