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

// created 2022-10-05T07:05:10.657Z
var r$1 = read_compressed_payload('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');

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

/*
export function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}
*/
function explode_cp(s) { // this is about 2x faster
	let cps = [];
	for (let pos = 0, len = s.length; pos < len; ) {
		let cp = s.codePointAt(pos);
		pos += cp < 0x10000 ? 1 : 2;
		cps.push(cp);
	}
	return cps;
}

function str_from_cps(cps) {
	return String.fromCodePoint(...cps);
}

// created 2022-10-05T07:05:10.723Z
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
function read_valid_subset() {
	return new Set(read_member_array(r$1, SORTED_VALID));
}
const CM = read_valid_subset();
const ISOLATED = read_valid_subset();
const SCRIPTS = ['Latin', 'Greek', 'Cyrillic'].map((k, i) => {
	// this defines the priority
	// order must match make.js
	// note: there are no latin (index = 0) whole-script confusables
	// (script name, script-set, whole-set?)
	return [k, read_valid_subset(), i ? read_valid_subset() : 0]; 
});
const EXCLUDED = read_array_while(() => {
	let v = read_valid_subset();
	if (v.size) return v;
});
const EMOJI_SOLO = new Set(read_member_array(r$1));
const EMOJI_ROOT = read_emoji_trie(r$1);
const NFC_CHECK = read_valid_subset();

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

// check that cp is not touching another cp
// optionally disallow leading/trailing
function check_surrounding(cps, cp, name, no_leading, no_trailing) {
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

function check_scripts_latin_like(cps) {
	// https://www.unicode.org/reports/tr39/#mixed_script_confusables
	for (let i = 0; i < SCRIPTS.length; i++) {
		let [name, script_set, whole_set] = SCRIPTS[i];
		if (cps.some(cp => script_set.has(cp))) {
			for (let j = i + 1; j < SCRIPTS.length; j++) { // scripts before already had no match
				let [name_j, set_j] = SCRIPTS[j];
				if (cps.some(cp => set_j.has(cp))) {
					throw new Error(`mixed-script confusable: ${name} + ${name_j}`);
				}
			}
			if (whole_set) { // aka non-latin
				// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
				// if every char matching the script is confusable
				if (cps.every(cp => !script_set.has(cp) || whole_set.has(cp))) {
					throw new Error(`whole-script confusable: ${name}`);
				}
			}
			break;
		}
	}
}

// requires decomposed codepoints
function check_excluded_scripts(cps) {
	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	for (let set of EXCLUDED) {
		if (cps.some(cp => set.has(cp))) { // first with one match
			if (!cps.every(cp => set.has(cp) || cp == FE0F)) { // must match all (or emoji)
				throw new Error(`excluded script cannot mix`);
			}
			break; // pure
		}
	}
}

// requires decomposed codepoints
function check_combinining_marks(cps) {
	for (let i = 0, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			if (i == 0) {
				throw new Error(`leading combining mark`);
			} else if (i == j) {
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i - 2, i + 1))}"`);
			} else {
				let prev = cps[i - 1];
				if (prev == FE0F || ISOLATED.has(prev)) {
					throw new Error(`isolate combining mark`);
				}
			}	
			j = i + 1;
		}
	}
}

// this function only makes sense if the input 
// was an output of ens_normalize_fragment 
function ens_normalize_post_check(norm) {
	for (let label of norm.split('.')) {
		if (!label) throw new Error('Empty label');
		try {
			let cps_nfc = explode_cp(label);
			check_leading_underscore(cps_nfc);
			check_label_extension(cps_nfc);
			check_surrounding(cps_nfc, 0x2019, 'apostrophe', true, true); // question: can this be generalized better?
			check_middle_dot(cps_nfc); // this a lot of effort for 1 character
			check_scripts_latin_like(cps_nfc);
			// replace emoji with single character
			let cps_nfd = nfd(process(label, () => [FE0F])); 
			check_combinining_marks(cps_nfd);
			check_excluded_scripts(cps_nfd); // idea: it's probably safe to early terminate if this is pure
		} catch (err) {
			throw new Error(`Invalid label "${label}": ${err.message}`);
		}
	}
	return norm;
}

function ens_normalize_fragment(frag, nf = nfc) {
	return str_from_cps(nf(process(frag, filter_fe0f)));
}

function ens_normalize(name) {
	return ens_normalize_post_check(ens_normalize_fragment(name));
}

// note: does not post_check
function ens_beautify(name) {
	return str_from_cps(nfc(process(name, x => x)));
}

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
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				output.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					output.push(...cps);
				} else if (!IGNORED.has(cp)) {
					throw new Error(`Disallowed codepoint: 0x${hex_cp(cp)}`);
				}
			}
		}
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
	if (!emoji) {
		let cp = cps[cps.length-1];
		if (EMOJI_SOLO.has(cp)) {
			if (eaten) eaten.push(cp);
			emoji = [cp];
			cps.pop();
		}
	}
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = cps.slice(); // copy stack
	if (node.valid == 2) copy.splice(1, 1); // delete FE0F at position 1 (see: make.js)
	return copy;
}

// return all supported emoji (not sorted)
function ens_emoji() {
	let ret = [...EMOJI_SOLO].map(x => [x]);
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
const TY_ISOLATED = 'isolated';
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
				if (ISOLATED.has(cp)) {
					tokens.push({type: TY_ISOLATED, cp});
				} else {
					tokens.push({type: TY_VALID, cps: [cp]});
				}
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
