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
	// 0x22 " (double-quote)
	// 0x7F DEL
	return s.replace(/[^\x20-\x21\x23-\x7E]/gu, x => quote_cp(x.codePointAt(0)));
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

var PAYLOAD$2 = 'ACUAAQDpAIEAfgBLAFkAawBgADAAVQAmACMAIgAlACAAPQAXABMAFQAOAA0ADAATABIAEgAPABEACwAMAAwAFAAlAA4CiAD2AAMEfQRvDCAA6xbF2ewNxQcEpzEwUhdEIQ4MFPFdAQR+Xghu/sUJhTcAxgAjDIIT11i1UgSFFg5DORgJEggA8l1t/b8GgzAAwgAECncPWK5LBIPsVokBEm8EjVUKOSQHJQoSRAAkpU4lim0AaUYDM38ErACLsk0bwwE9Py5BYQFLAfUFWXmEMgEEQlUcDdxTNj3nMabMOtteTE7wrBKhLiUA8HAuAPZKIwPMS5cW4WkBPiA9AKFuMnGFBgKIGAkPEAICHRQQGRAAWAgAGCY2AV4+HA4+By4BCA4OI0IXAgIaFiELCt72BhR4WAC0AEQCQgLeyQ4dAQs6OQo9Pg4eH4lDGN5VrgAeDh4wDkUlAh4sAgwCAg8NFgAeVCqOBxMZTm4C7AM6BA5lDjQhjj4LAQ4HFn4GBg4dIwAeCQcuIxMRAhsmDoEeGY4WHRkODB6ufj0uEAQMHAAuEm4jBwAeqR0C304J7k4DDg6uIt4BHjAOFQGhni4hKxbeA94hzgAuCW5OEZ6O3gcfAAAQXn40JiAANBIYGBgYGgEVFANZAN4VACAODgPOB/4eVAgODI6l3g8evhVuKC4G3gr+3v7eAJ8xaoQEDxUHDgILBgBXBxchNAFdNxI3ACQGChYOFg4aCZ70BBMHIyzewwQWNDgJPA4LDhCFQRieVWsAGw0uRCASIgQOBxEYUyqCDxlMSDdZCwsPAgQDfAICBhIAFQgUDwIBEg0WERARCQ0xCAYMJwQEAwJ5TaJBAw0BJQEXLw45KRYW1gO0AAEAaklS1AUcGTMlHwAyERcXFxcA3gsKGBsKpb4PF7wVYBwPAPwSKf7c/twFvADjBN8+AQMAA34ADpgelQ9gBRwYYgLm2WYCr9PLGBAJzhANkwEBZU0AcmA8UgHw1AIsBJ8CuREAEAVbADUN4E45AeJxUvNSfwK0AOB9Bl1loWFBA3QYGBgYChoNDlwFIYoDANxjAOdXAMYA2gDfYwGgAzQB6QAzACJ4BL8PPhcAyYhoAKEBMQFUACzlXkPODDwAAzsRChOJRRjAVa4AW09gAAYaAdRQsm8MAndjAC4uCIcD9wTsCFObqROxVN4azu4OThg91H4Cu14+Hg4uAD5yA0j+3v7e/t7+3v7e/t7+3v7e/t7+3v7e/t4A0Pzs/t7+3gIADg4AhG8GAKAAMQFSRzw3tAIeFQABKyA1CkIDArZSNxYGADJxFeAM7kwEnod/ygAbEhkPHAIlEhkTHBEWIxlvEic5XmJrmgYHEHhnxxmTgt4PaXlhsZIQPA4SE81ODwW9wQY9BKBNMI86Q38/5DoAYUwBZXtFAdEsUJZzaW8HCL0B3wBh7A4qGWkkVCMJDh0QPD0eAx4lukgZTkBLLjdyAbYCkyAgWHm8HxsuFBMAGxt4pgHuCv3PAShNdLQIMAATfSQXFEtbDFHyBDQFaQqLAR0AZXkalBkSJQUxFESLGQmmT841T0vm4HcFCA8AdjhaLwBBStseAz1L7BFBDgEVA3YGnBk+BD3oAJoEwlILFppOCwIeDBUQzntD+oaxJbOqEsPmVoztmeEOgU272aOQMCbwOpB/Ypso4k/TTLW0oWpP3Rz3gHw2yY1UgZPtktnZk107pZPg3CQ+O2NJZ4RdQ8VrO8v8sA5Nf64eb7biK378+U434pbsbN5D/nUXJvQoZ2tsF7kCJBqxJCTNIptt2KVrMk9oCmdP0yza2mLjtAXAvD9RwvMgHNASOAHQHieInuWJb1575ohdCFscyN5HjENm6r3fmapvd12TrCubUm7XFYfHvmy8dSIQOESuJavaW0D8rbUXGUc7rPRuiWRnOFLlYcrqLc3LiwzjN7uzF6ECR7SY0Tzdx+FJN5Dl8dSD9VRuo2SKneiXQYjuXJ70nT50AuF9I7taX6vp5rEML9UbCTMpLStDd8XHbeVYsjSuXkuxcXDGzy11XOqM4/Ld+ZRABTvb0FzlY8mXbveszS4/glZhNu5eLJmy5AooQTWVutjvuWDrsDkUZ9am2TOeKMG8TLHRwjVBB4FhPtiujqXvesGvWwQ1w3s89y+jX47rIhp+El9c2QFM4BVQggIR28OeFU3V5TjwdLSSW8/9MAJ+qPuP74Iy+oDcIeIjgCJGHt52YnnwJV5+xKR+HjQws+fTAiOhcOW+zy609VzzQk+y0A7kdHdBBsXBB36UOFdzdYujG5PO1IXoFWrs3trl6gV4JKHvTsSvFdHz22LQv21L1uh45KVqrt+uUQyVd6ulDXkU/TOXxUk+HcujwWsIGjbyNKggFFDe5Mc4eHSKGezjtMlWeigB0nB6+8BrawOjtBF04xeKukf+o037M7ExZxCAGsVZ0PpTtc1TJlHhU+eUkh3LpBhTs2XCQewf98wydOE14KvF948SMOcIGmBFbIJR1V45meM46ACb1xWIaoJ3MkVdmkp7LuDsLQXzO742rKyrd/KspPEmjyviR3dNO/MNxJTes46EMlMdsAMMLPebHcs5hRcRuz1/3OWqWFHqsh7caP90rBA5z+0izaxZSEowxCpGcXJQmNX9ZRy7Wv2wppZZq5X96vy3Rhy6NkxfjqH4/xB5uK7Icux88zxeKS7HmRvYcD8R+lFRBO5I2hpXjDgvpLU+7LiZ7rsriL2IYSB5FoDZgc0aM7b51cp3qP5LO1LVPlSZunn1e/++/NlO4eEbUxhPePIEkeDKLV5SOXSS+SdvvpIbWH7fhP2kZRVCfvWrXrTny8dF2vD0/c17qfSxPu4hBzxzYL0X0HiW3j4APx7arPhNWGGOMWyuGGwuycrdUX3N1O3MCM+qWMORw+vbHSf7dxpmse8hGZvWaY9vtOvMRlFdhveoSnJLhb63k7kZxhLgSnbSVrw4SgaQmAVbn9aMlXJUuAW5/7DeZtB3AXYZJsC8u7TQ3U6MRQH3W0Y+TbKy23n6WDnjFbCNWCdxG69uYaQ65G91unS+/VBV5ogka0CGR7Pv1YajbSPKr+opmKCb8f/fHsNZ6yFhw4UYHSVjedw+2yeZ5IuZ6t35SPLGkb2zQC2XtoVv4vfHXPMH9GXD0mvawBsT2wVm/NdfNcvMGrXSpnK8FBBUUazjP+S4U5ffPk0rTU/FefFYW+Y2Ir95i4j0HghljDTPXjDwRIS9jeeG8RSNJV1X7TJVb/w2cACSCwugUvUcxGm9OQL9SDI=';

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

// built: 2022-01-05T07:15:53.378Z
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

export { ens_normalize, ens_tokenize };
