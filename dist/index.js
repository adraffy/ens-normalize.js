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

// created 2022-10-05T07:38:22.496Z
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

// created 2022-10-05T07:38:22.566Z
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
			throw new Error(`Invalid label "${label}": ${err.message}`); // note: label might not exist in the input string
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
