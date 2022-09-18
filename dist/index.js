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

// created 2022-09-18T21:14:12.408Z
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

// created 2022-09-18T21:14:12.440Z
var r = read_compressed_payload('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');

// for reference implementation

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
	DECOMP.set(cp, cps.reverse());
}

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
	if (a >= L0 && a < L1 && b >= V0 && b < V1) { // LV
		let l_index = a - L0;
		let v_index = b - V0;
		let lv_index = l_index * N_COUNT + v_index * T_COUNT;
		return S0 + lv_index;
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
	for (let cp0 of cps) {
		buf[0] = cp0;
		do {
			let cp = buf.pop();
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
		} while (buf.length);
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
		({node} = br);
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
				let str0 = str_from_cps(cps0);
				let cps = nfc(cps0); // this does extra work for nf-native but oh well
				let str = str_from_cps(cps);
				if (str0 === str) {
					i = end - 1; // skip to end of slice
				} else {
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
