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
function read_payload(v) {
	let pos = 0;
	return () => v[pos++];
}
function read_compressed_payload(s) {	
	return read_payload(decode_arithmetic(unsafe_atob(s)));
}

// unsafe in the sense:
// expected well-formed Base64 w/o padding 
function unsafe_atob(s) {
	let lookup = [];
	[...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].forEach((c, i) => lookup[c.charCodeAt(0)] = i);
	let n = s.length;
	let ret = new Uint8Array((6 * n) >> 3);
	for (let i = 0, pos = 0, width = 0, carry = 0; i < n; i++) {
		carry = (carry << 6) | lookup[s.charCodeAt(i)];
		width += 6;
		if (width >= 8) {
			ret[pos++] = (carry >> (width -= 8));
		}
	}
	return ret;
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

// return unsorted? unique array 
function read_member_array(next, lookup) {
	let v = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < vN[i]; j++) {
			v.push(vX[i] + j);
		}
	}
	return lookup ? v.map(x => lookup[x]) : v;
}

// returns map of x => ys
function read_mapped(next) {
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
	return ret.flat();
}

// read until next is falsy
// return array of read values
function read_array_while(next) {
	let v = [];
	while (true) {
		let x = next();
		if (!x) break;
		v.push(x);
	}
	return v;
}

// read w columns of length n
// return as n rows of length w
function read_transposed(n, w, next) {
	let m = Array(n).fill().map(() => []);
	for (let i = 0; i < w; i++) {
		read_deltas(n, next).forEach((x, j) => m[j].push(x));
	}
	return m;
}
 
// returns [[x, ys], [x+dx, ys+dy], [x+2*dx, ys+2*dy], ...]
// where dx/dy = steps, n = run size, w = length of y
function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let vN = read_array_while(next);
	let m = read_transposed(vN.length, 1+w, next);
	return m.flatMap((v, i) => {
		let [x, ...ys] = v;
		return Array(vN[i]).fill().map((_, j) => {
			let j_dy = j * dy;
			return [x + j * dx, ys.map(y => y + j_dy)];
		});
	});
}

// return [[x, ys...], ...]
// where w = length of y
function read_replacement_table(w, next) { 
	let n = 1 + next();
	let m = read_transposed(n, 1+w, next);
	return m.map(v => [v[0], v.slice(1)]);
}

function read_emoji_trie(next) {
	let sorted = read_member_array(next).sort((a, b) => a - b);
	return read();
	function read() {
		let branches = [];
		while (true) {
			let keys = read_member_array(next, sorted);
			if (keys.length == 0) break;
			branches.push({set: new Set(keys), node: read()});
		}
		branches.sort((a, b) => b.set.size - a.set.size); // sort by likelihood
		let temp = next();
		let valid = temp % 3;
		temp = (temp / 3)|0;
		let fe0f = !!(temp & 1);
		temp >>= 1;
		let save = temp == 1;
		let check = temp == 2;
		return {branches, valid, fe0f, save, check};
	}
}

// created 2022-09-21T09:14:26.747Z
var r$1 = read_compressed_payload('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');

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}
function str_from_cps(cps) {
	return String.fromCodePoint(...cps);
}

// created 2022-09-21T09:14:26.778Z
var r = read_compressed_payload('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');

// https://unicode.org/reports/tr15/

function unpack_cc(packed) {
	return (packed >> 24) & 0xFF;
}
function unpack_cp(packed) {
	return packed & 0xFFFFFF;
}

const SHIFTED_RANK = new Map(read_array_while(() => {
	let v = read_member_array(r);
	if (v.length) return v;
}).flatMap((v, i) => v.map(x => [x, (i+1) << 24]))); // pre-shifted

const EXCLUSIONS = new Set(read_member_array(r));
const DECOMP = new Map();
const RECOMP = new Map();
for (let [cp, cps] of read_mapped(r)) {
	if (!EXCLUSIONS.has(cp) && cps.length == 2) {
		let [a, b] = cps;
		let bucket = RECOMP.get(a);
		if (!bucket) {
			bucket = new Map();
			RECOMP.set(a, bucket);
		}
		bucket.set(b, cp);
	}
	DECOMP.set(cp, cps.reverse()); // stored reversed
}

// algorithmic hangul
// https://www.unicode.org/versions/Unicode15.0.0/ch03.pdf (page 144)
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

function compose_pair(a, b) {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) {
		return S0 + (a - L0) * N_COUNT + (b - V0) * T_COUNT;
	} else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
		return a + (b - T0);
	} else {
		let recomp = RECOMP.get(a);
		if (recomp) {
			recomp = recomp.get(b);
			if (recomp) {
				return recomp;
			}
		}
		return -1;
	}
}

function decomposed(cps) {
	let ret = [];
	let buf = [];
	let check_order = false;
	function add(cp) {
		let cc = SHIFTED_RANK.get(cp);
		if (cc) {
			check_order = true;
			cp |= cc;
		}
		ret.push(cp);
	}
	for (let cp of cps) {
		while (true) {
			if (cp < 0x80) {
				ret.push(cp);
			} else if (is_hangul(cp)) {
				let s_index = cp - S0;
				let l_index = s_index / N_COUNT | 0;
				let v_index = (s_index % N_COUNT) / T_COUNT | 0;
				let t_index = s_index % T_COUNT;
				add(L0 + l_index);
				add(V0 + v_index);
				if (t_index > 0) add(T0 + t_index);
			} else {
				let mapped = DECOMP.get(cp);
				if (mapped) {
					buf.push(...mapped);
				} else {
					add(cp);
				}
			}
			if (!buf.length) break;
			cp = buf.pop();
		}
	}
	if (check_order && ret.length > 1) {
		let prev_cc = unpack_cc(ret[0]);
		for (let i = 1; i < ret.length; i++) {
			let cc = unpack_cc(ret[i]);
			if (cc == 0 || prev_cc <= cc) {
				prev_cc = cc;
				continue;
			}
			let j = i-1;
			while (true) {
				let tmp = ret[j+1];
				ret[j+1] = ret[j];
				ret[j] = tmp;
				if (!j) break;
				prev_cc = unpack_cc(ret[--j]);
				if (prev_cc <= cc) break;
			}
			prev_cc = unpack_cc(ret[i]);
		}
	}
	return ret;
}

function composed_from_decomposed(v) {
	let ret = [];
	let stack = [];
	let prev_cp = -1;
	let prev_cc = 0;
	for (let packed of v) {
		let cc = unpack_cc(packed);
		let cp = unpack_cp(packed);
		if (prev_cp == -1) {
			if (cc == 0) {
				prev_cp = cp;
			} else {
				ret.push(cp);
			}
		} else if (prev_cc > 0 && prev_cc >= cc) {
			if (cc == 0) {
				ret.push(prev_cp, ...stack);
				stack.length = 0;
				prev_cp = cp;
			} else {
				stack.push(cp);
			}
			prev_cc = cc;
		} else {
			let composed = compose_pair(prev_cp, cp);
			if (composed >= 0) {
				prev_cp = composed;
			} else if (prev_cc == 0 && cc == 0) {
				ret.push(prev_cp);
				prev_cp = cp;
			} else {
				stack.push(cp);
				prev_cc = cc;
			}
		}
	}
	if (prev_cp >= 0) {
		ret.push(prev_cp, ...stack);	
	}
	return ret;
}

function nfd(cps) {
	return decomposed(cps).map(unpack_cp);
}

function nfc(cps) {
	return composed_from_decomposed(decomposed(cps));
}

const SORTED_VALID = read_member_array(r$1).sort((a, b) => a - b);
const VALID = new Set(SORTED_VALID);
const IGNORED = new Set(read_member_array(r$1));
const MAPPED = new Map(read_mapped(r$1));
const CM = new Set(read_member_array(r$1, SORTED_VALID));
const EMOJI_ROOT = read_emoji_trie(r$1);
const NFC_CHECK = new Set(read_member_array(r$1, SORTED_VALID));

const STOP = 0x2E;
const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const FE0F = 0xFE0F;

function check_leading_underscore(cps) {
	let i = cps.lastIndexOf(UNDERSCORE);
	while (i > 0) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error(`underscore only allowed at start`);
		}
	}
}

function check_label_extension(cps) {
	if (cps.length >= 4 && cps[2] === HYPHEN && cps[3] === HYPHEN && cps.every(cp => cp < 0x80)) {
		throw new Error(`invalid label extension`);
	}
}

function check_isolated(cps, cp, name, no_leading, no_trailing) {
	let last = -1;
	if (cps[0] === cp) {
		if (no_leading) throw new Error(`leading ${name}`);
		last = 0;
	}
	while (true) {
		let i = cps.indexOf(cp, last+1);
		if (i == -1) break;
		if (last == i-1) throw new Error(`adjacent ${name}`);
		last = i;
	}
	if (no_trailing && last == cps.length-1) throw new Error(`trailing ${name}`);
}

// ContextO: MIDDLE DOT
// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
// Between 'l' (U+006C) characters only, used to permit the Catalan character ela geminada to be expressed.
function check_middle_dot(cps) {
	let i = 0;
	while (true) {
		i = cps.indexOf(0xB7, i);
		if (i == -1) break;
		if (cps[i-1] !== 0x6C || cps[i+1] !== 0x6C) throw new Error('ContextO: middle dot');
		i += 2;
	}
}

// requires decomposed codepoints
function check_cm(cps) {
	for (let i = 0, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			if (i == 0) {
				throw new Error(`leading combining mark`);
			} else if (i == j) {
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i - 2, i + 1))}"`);
			} else if (cps[i - 1] == FE0F) {
				throw new Error(`emoji + combining mark`);
			}	
			j = i + 1;
		}
	}
}

function ens_normalize_post_check(norm) {
	for (let label of norm.split('.')) {
		if (!label) throw new Error('Empty label');
		try {
			let cps_nfc = explode_cp(label);
			check_leading_underscore(cps_nfc);
			check_label_extension(cps_nfc);
			check_isolated(cps_nfc, 0x2019, 'apostrophe', true, true);
			check_middle_dot(cps_nfc);
			let cps_nfd = nfd(process(label, () => [FE0F])); // replace emoji with single character
			check_cm(cps_nfd);
		} catch (err) {
			throw new Error(`Invalid label "${label}": ${err.message}`);
		}
	}
	return norm;
}

function ens_normalize_fragment(frag) {
	return str_from_cps(nfc(process(frag, filter_fe0f)));
}

function ens_normalize(name) {
	return ens_normalize_post_check(ens_normalize_fragment(name));
}

// note: does not post_check
// insert 200B between regional indicators so they do not collapse into flags
function ens_beautify(name) {
	return str_from_cps(nfc(process(name, emoji => emoji))).replace(/[\u{1F1E6}-\u{1F1FF}]{2,}/gu, s => [...s].join('\u200B'));
}

/*
function is_regional_indicator(cp) {
	return 0x1F1E6 >= cp && 0x1F1FF <= cp;
}
*/

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
}

function process(name, emoji_filter) {
	let input = explode_cp(name).reverse(); // flip so we can pop
	let output = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			output.push(...emoji_filter(emoji)); // idea: emoji_filter(emoji, output.length); // provide position to callback
			continue;
		}
		let cp = input.pop();
		if (VALID.has(cp)) {
			output.push(cp);
			continue;
		} 
		if (IGNORED.has(cp)) {
			continue;
		}
		let cps = MAPPED.get(cp);
		if (cps) {
			output.push(...cps);
			continue;
		}
		throw new Error(`Disallowed codepoint: 0x${hex_cp(cp)}`);
	}
	return output;
}

function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let saved;
	let stack = [];
	let pos = cps.length;
	if (eaten) eaten.length = 0; // clear input buffer (if needed)
	while (pos) {
		let cp = cps[--pos];
		let br = node.branches.find(x => x.set.has(cp));
		if (!br) break;
		node = br.node;
		if (node.save) { // remember
			saved = cp;
		} else if (node.check) { // check exclusion
			if (cp === saved) break;
		}
		stack.push(cp);
		if (node.fe0f) {
			stack.push(FE0F);
			if (pos > 0 && cps[pos - 1] == FE0F) pos--; // consume optional FE0F
		}
		if (node.valid) { // this is a valid emoji (so far)
			emoji = conform_emoji_copy(stack, node);
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = cps.slice(); // copy stack
	if (node.valid == 2) copy.splice(1, 1); // delete FE0F at position 1 (RGI ZWJ don't follow spec!, see: make.js)
	return copy;
}

// return all supported emoji
// not sorted
function ens_emoji() {
	let ret = [];
	build(EMOJI_ROOT, []);
	return ret;
	function build(node, cps, saved) {
		if (node.save) { // remember
			saved = cps[cps.length-1];
		} else if (node.check) { // check exclusion
			if (saved === cps[cps.length-1]) return;
		}
		if (node.fe0f) cps.push(FE0F);
		if (node.valid) ret.push(conform_emoji_copy(cps, node));
		for (let br of node.branches) {
			for (let cp of br.set) {
				build(br.node, [...cps, cp], saved);
			}
		}
	}
}

// ************************************************************
// tokenizer 

const TY_VALID = 'valid';
const TY_MAPPED = 'mapped';
const TY_IGNORED = 'ignored';
const TY_DISALLOWED = 'disallowed';
const TY_EMOJI = 'emoji';
const TY_NFC = 'nfc';
const TY_STOP = 'stop';

function ens_tokenize(name) {
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({type: TY_EMOJI, emoji, input: eaten.slice(), cps: filter_fe0f(emoji)});
		} else {
			let cp = input.pop();
			if (cp === STOP) {
				tokens.push({type: TY_STOP});
			} else if (VALID.has(cp)) {
				tokens.push({type: TY_VALID, cps: [cp]});
			} else if (IGNORED.has(cp)) {
				tokens.push({type: TY_IGNORED, cp});
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					tokens.push({type: TY_MAPPED, cp, cps: cps.slice()});
				} else {
					tokens.push({type: TY_DISALLOWED, cp});
				}
			}
		}
	}
	for (let i = 0, start = -1; i < tokens.length; i++) {
		let token = tokens[i];
		if (is_valid_or_mapped(token.type)) {
			if (requires_check(token.cps)) { // normalization might be needed
				let end = i + 1;
				for (let pos = end; pos < tokens.length; pos++) { // find adjacent text
					let {type, cps} = tokens[pos];
					if (is_valid_or_mapped(type)) {
						if (!requires_check(cps)) break;
						end = pos + 1;
					} else if (type !== TY_IGNORED) { // || type !== TY_DISALLOWED) { 
						break;
					}
				}
				if (start < 0) start = i;
				let slice = tokens.slice(start, end);
				let cps0 = slice.flatMap(x => is_valid_or_mapped(x.type) ? x.cps : []); // strip junk tokens
				let cps = nfc(cps0); // this does extra work for nf-native but oh well
				//if (cps0.length === cps.length && cps0.every((cp, i) => cp === cps[i])) { 
				if (str_from_cps(cps0) === str_from_cps(cps)) {
					i = end - 1; // skip to end of slice
				} else { // bundle into an nfc token
					tokens.splice(start, end - start, {type: TY_NFC, input: cps0, cps, tokens: collapse_valid_tokens(slice)});
					i = start;
				}
				start = -1; // reset
			} else {
				start = i; // remember last
			}
		} else if (token.type === TY_EMOJI) {
			start = -1; // reset
		}
	}
	return collapse_valid_tokens(tokens);
}

function is_valid_or_mapped(type) {
	return type === TY_VALID || type === TY_MAPPED;
}

function requires_check(cps) {
	return cps.some(cp => NFC_CHECK.has(cp));
}

function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type === TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type === TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_normalize_post_check, ens_tokenize, nfc, nfd };
