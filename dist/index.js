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

// created 2022-10-13T05:53:20.550Z
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

// created 2022-10-13T05:53:20.624Z
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
const RESTRICTED = read_array_while(() => {
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
function check_restricted_scripts(cps) {
	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	for (let set of RESTRICTED) {
		if (cps.some(cp => set.has(cp))) { // first with one match
			if (!cps.every(cp => set.has(cp) || cp == FE0F)) { // must match all (or emoji)
				throw new Error(`restricted script cannot mix`);
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
			check_restricted_scripts(cps_nfd); // idea: it's probably safe to early terminate if this is pure
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
