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

// created 2022-10-15T07:58:21.554Z
var r$1 = read_compressed_payload('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');
const SCRIPT_ORDER = ["Latin","Greek","Cyrillic"];

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

// created 2022-10-15T07:58:21.621Z
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
const SCRIPTS = SCRIPT_ORDER.map(name => {
	return [name, read_valid_subset(), read_valid_subset()]; // [set, wholes]
});
const RESTRICTED_WHOLES = read_valid_subset();
const RESTRICTED = read_array_while(() => { // TODO: include script names? (it's 2KB)
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
	let e = cps.lastIndexOf(UNDERSCORE);
	for (let i = e; i > 0; ) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error(`underscore only allowed at start`);
		}
	}
	return e + 1;
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
			if (whole_set.size) { 
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
function check_restricted_scripts(cps) {
	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	for (let set of RESTRICTED) {
		if (cps.some(cp => set.has(cp))) { // first with one match
			if (!cps.every(cp => cp == FE0F || set.has(cp))) { // must match all (or emoji)
				throw new Error(`restricted script cannot mix`);
			}
			if (cps.every(cp => cp == FE0F || RESTRICTED_WHOLES.has(cp))) {
				throw new Error(`restricted whole-script confusable`);
			}
			return true;
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
			let n_under = check_leading_underscore(cps_nfc);
			let cps_nfd = nfd(process(label.slice(n_under), () => [FE0F])); // replace emoji with single character
			check_combinining_marks(cps_nfd);
			if (check_restricted_scripts(cps_nfd)) continue; // it's pure
			check_label_extension(cps_nfc);
			check_surrounding(cps_nfc, 0x2019, 'apostrophe', true, true); // question: can this be generalized better?
			check_middle_dot(cps_nfc); // this a lot of effort for 1 character
			check_scripts_latin_like(cps_nfc);
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

/*
// this is dumb, tokens are better are pure data
class EmojiToken {
	constructor(input, emoji) {
		this.input = input;
		this.emoji = emoji;
	}
	get type() {
		return TY_EMOJI;
	}
	get cps() {
		return filter_fe0f(this.cps);
	}	
}
class SingleToken {
	constructor(type, cp) {
		this.type = type;
		this.cp = cp;
	}
	get input() { return [this.cp]; }
	get cps() { return this.input() }
}
class MappedToken extends SingleToken {
	constructor(cp, cps) {
		this.cp = cp;
		this.cps = cps;
	}
	get type() { return TY_MAPPED; }
	get input() { return [this.cp]; }
}
class NFCToken {
	constructor(tokens) {

	}
}
*/

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
				tokens.push({type: TY_STOP, cp});
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
