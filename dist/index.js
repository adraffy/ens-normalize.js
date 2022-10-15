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

// created 2022-10-15T07:29:22.542Z
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

// created 2022-10-15T07:29:22.619Z
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
