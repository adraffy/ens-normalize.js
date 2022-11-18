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

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// [123][5] => [0 3] [1 1] [0 0]
function read_sorted(next, prev = 0) {
	let ret = [];
	while (true) {
		let x = next();
		let n = next();
		if (!n) break;
		prev += x;
		for (let i = 0; i < n; i++) {
			ret.push(prev + i);
		}
		prev += n + 1;
	}
	return ret;
}

function read_sorted_arrays(next) {
	return read_array_while(() => { 
		let v = read_sorted(next);
		if (v.length) return v;
	});
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
		let x = next(v.length);
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

// created 2022-11-18T09:54:03.015Z
var r$1 = read_compressed_payload('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');
const FENCED = new Map([[8217,"apostrophe"],[8260,"fraction slash"]]);
const NR = 29;

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function quote_cp(cp) {
	return `{${hex_cp(cp)}}`; // raffy convention: like "\u{X}" w/o the "\u"
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
	const chunk = 4096;
	let len = cps.length;
	if (len < chunk) return String.fromCodePoint(...cps);
	let buf = [];
	for (let i = 0; i < len; ) {
		buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
	}
	return buf.join('');
}

function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

function random_choice(v, rng = Math.random) {
	return v[rng() * v.length|0];
}

function random_sample(v, n, rng = Math.random) {
	v = v.slice(); // make copy
	if (v.length > n) {
		for (let i = 0; i < n; i++) { // shuffle prefix n
			let temp = v[i]; 
			let j = Math.floor(i + rng() * (v.length - i));
			v[i] = v[j];
			v[j] = temp;
		}
		v = v.slice(0, n); // truncate
	}
	return v;
}

function run_tests(fn, tests) {
	let errors = [];
	for (let test of tests) {
		let {name, norm, error} = test;
		if (typeof norm !== 'string') norm = name;
		try {
			let result = fn(name);
			if (error) {	
				errors.push({type: 'expected error', result, ...test});
			} else if (result != norm) {
				errors.push({type: 'wrong norm', result, ...test});
			}
		} catch (err) {
			if (!error) {
				errors.push({type: 'unexpected error', result: err.message, ...test});
			}
		}
	}
	return errors;
}

// created 2022-11-18T09:54:03.143Z
var r = read_compressed_payload('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');

// https://unicode.org/reports/tr15/

function unpack_cc(packed) {
	return (packed >> 24) & 0xFF;
}
function unpack_cp(packed) {
	return packed & 0xFFFFFF;
}

const SHIFTED_RANK = new Map(read_sorted_arrays(r).flatMap((v, i) => v.map(x => [x, (i+1) << 24]))); // pre-shifted
const EXCLUSIONS = new Set(read_sorted(r));
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

function read_set() {
	return new Set(read_sorted(r$1));
}
/*
function read_str(n) {
	return str_from_cps(read_deltas(n, r));
}
*/
const MAPPED = new Map(read_mapped(r$1)); 
const IGNORED = read_set(); // ignored characters are not valid, so just read raw codepoints
/*
const FENCED = new Map(read_array_while(() => {
	let cp = r();
	if (cp) return [cp, read_str(r())];
}));
*/
const CM = read_set();
const ESCAPE = read_set(); // characters that should not be printed
const NFC_CHECK = read_set();
const CHUNKS = read_sorted_arrays(r$1);
function read_chunked() {
	return new Set([read_sorted(r$1).map(i => CHUNKS[i]), read_sorted(r$1)].flat(2));
}
const GROUPS = read_array_while(i => {
	let N = read_array_while(r$1).map(x => x+0x60);
	if (N.length) {
		let R = i >= NR; // first NR are non-restricted
		N[0] -= 32; // capitalize
		N = str_from_cps(N);
		if (R) N=`Restricted[${N}]`;
		let P = read_chunked(); // primary
		let Q = read_chunked(); // secondary
		let V = [...P, ...Q].sort((a, b) => a-b); // derive: sorted valid
		let M = r$1()-1; // combining mark
		// code currently isn't needed
		/*if (M < 0) { // whitelisted
			M = new Map(read_array_while(() => {
				let i = r();
				if (i) return [V[i-1], read_array_while(() => {
					let v = read_array_while(r);
					if (v.length) return v.map(x => x-1);
				})];
			}));
		}*/
		return {N, P, M, R, V: new Set(V)};
	}
});
const WHOLES = new Map(read_array_while(() => {
	let cps = read_sorted(r$1);
	if (cps.length) {
		let set = read_set();
		//let whole = {set, cps};
		// at the moment, we just need the set
		return cps.map(cp => [cp, set]);
	}
}).flat());
const EMOJI_SORTED = read_sorted(r$1);
//const EMOJI_SOLO = new Set(read_sorted(r).map(i => EMOJI_SORTED[i]));
const EMOJI_ROOT = read_emoji_trie([]);
function read_emoji_trie(cps) {
	let B = read_array_while(() => {
		let keys = read_sorted(r$1).map(i => EMOJI_SORTED[i]);
		if (keys.length) return read_emoji_trie(keys);
	}).sort((a, b) => b.Q.size - a.Q.size); // sort by likelihood
	let temp = r$1();
	let V = temp % 3; // valid (0 = false, 1 = true, 2 = weird)
	temp = (temp / 3)|0;
	let F = temp & 1; // allow FE0F
	temp >>= 1;
	let S = temp & 1; // save
	let C = temp & 2; // check
	return {B, V, F, S, C, Q: new Set(cps)};
}

const VALID = new Set();
const MULTI = new Set();
for (let g of GROUPS) {
	for (let cp of g.V) {
		if (VALID.has(cp)) {
			MULTI.add(cp);
		} else {
			VALID.add(cp);
		}
	}
}
for (let cp0 of VALID) {
	for (let cp of nfd([cp0])) {
		VALID.add(cp);
	}
}
const UNIQUE = new Map(GROUPS.flatMap(g => [...g.V].filter(cp => !MULTI.has(cp)).map(cp => [cp, g])));

const STOP = 0x2E;
const FE0F = 0xFE0F;
const STOP_CH = str_from_cps([STOP]);

// free tagging system
class Emoji extends Array {
	get is_emoji() { return true; }
}

// create a safe to print string 
// invisibles are escaped
// leading cm uses placeholder
function safe_str_from_cps(cps, quoter = quote_cp) {
	//if (Number.isInteger(cps)) cps = [cps];
	//if (!Array.isArray(cps)) throw new TypeError(`expected codepoints`);
	let buf = [];
	if (is_combining_mark(cps[0])) buf.push('◌');
	let prev = 0;
	let n = cps.length;
	for (let i = 0; i < n; i++) {
		let cp = cps[i];
		if (should_escape(cp)) {
			buf.push(str_from_cps(cps.slice(prev, i)));
			buf.push(quoter(cp));
			prev = i + 1;
		}
	}
	buf.push(str_from_cps(cps.slice(prev, n)));
	return buf.join('');
}

// if escaped: {HEX}
//       else: "x" {HEX}
function quoted_cp(cp) {
	return (should_escape(cp) ? '' : `"${safe_str_from_cps([cp])}" `) + quote_cp(cp);
}

function check_label_extension(cps) {
	const HYPHEN = 0x2D;
	if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
		throw new Error('invalid label extension');
	}
}
function check_leading_combining_mark(cps) {
	if (CM.has(cps[0])) throw new Error('leading combining mark');
}
function check_leading_underscore(cps) {
	const UNDERSCORE = 0x5F;
	for (let i = cps.lastIndexOf(UNDERSCORE); i > 0; ) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error('underscore allowed only at start');
		}
	}
}
// check that a fenced cp is not leading, trailing, or touching another fenced cp
function check_fenced(cps) {
	let cp = cps[0];
	let name = FENCED.get(cp);
	if (name) throw new Error(`leading ${name}`);
	let last = -1;
	for (let i = 1; i < cps.length; i++) {
		cp = cps[i];
		let match = FENCED.get(cp);
		if (match) {
			if (last == i) throw new Error(`adjacent ${name} + ${match}`);
			last = i + 1;
			name = match;
		}
	}
	if (last == cps.length) throw new Error(`trailing ${name}`);
}
/*
function check_fenced(cps) {
	for (let [cp, name] of FENCED) {
		if (cps[0] == cp) throw new Error(`leading ${name}`);
		let last = -1;
		while (true) {
			let next = cps.indexOf(cp, last+1);
			if (next == -1) break;
			if (next == last) throw new Error(`adjacent ${name}`);
			last = next + 1;
		}
		if (last == cps.length) throw new Error(`trailing ${name}`);
	}
}
*/

function is_combining_mark(cp) {
	return CM.has(cp);
}

function should_escape(cp) {
	return ESCAPE.has(cp);
}

function ens_normalize_fragment(frag, nf = nfc) {
	return frag.split(STOP_CH).map(label => str_from_cps(process(explode_cp(label), nf).flatMap(x => x.is_emoji ? filter_fe0f(x) : x))).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(ens_split(name));
}

function ens_beautify(name) {
	let split = ens_split(name, true);
	// this is experimental
	for (let {script, output, error} of split) {
		if (script !== 'Greek') { // ξ => Ξ if not greek
			let prev = 0;
			while (true) {
				let next = output.indexOf(0x3BE, prev);
				if (next < 0) break;
				output[next] = 0x39E; 
				prev = next + 1;
			}
		}
	}
	return flatten(split);
}

function ens_split(name, preserve_emoji) {
	let offset = 0;
	// https://unicode.org/reports/tr46/#Validity_Criteria 4.1 Rule 4
	// "The label must not contain a U+002E ( . ) FULL STOP."
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint, not substring!
		};
		offset += input.length + 1; // + stop
		let norm;
		try {
			let tokens = info.tokens = process(input, nfc); // if we parse, we get [norm and mapped]
			let token_count = tokens.length;
			let type;
			if (!token_count) { // the label was effectively empty (could of had ignored characters)
				norm = [];
				type = 'None'; // use this instead of "Common"
			} else {
				let chars = tokens[0];
				let emoji = token_count > 1 || chars.is_emoji;
				if (!emoji && chars.every(cp => cp < 0x80)) { // special case for ascii
					norm = chars;
					check_leading_underscore(norm);
					check_label_extension(norm); // only needed for ascii
					type = 'ASCII';
				} else {
					if (emoji) { // there is at least one emoji
						info.emoji = true; 
						chars = tokens.flatMap(x => x.is_emoji ? [] : x); // all of the nfc tokens concat together
					}
					norm = tokens.flatMap(x => !preserve_emoji && x.is_emoji ? filter_fe0f(x) : x);
					check_leading_underscore(norm);
					if (!chars.length) {
						type = 'Emoji';
					} else {
						check_leading_combining_mark(norm);
						check_fenced(norm);
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								throw new Error(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`);
							}
						}
						type = determine_group(chars).N;
					}
				}
			}
			info.type = type;
		} catch (err) {
			info.error = err;
		}
		info.output = norm;
		return info;
	});
}


function determine_group(cps) {
	// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
	let free = [];
	let confused = [];
	let cover;
	for (let cp of cps) {
		let set = WHOLES.get(cp);
		if (set) { // character is confusable
			//let {cps, set} = whole;
			confused.push(cp);
			if (cover) {
				cover = cover.filter(i => set.has(i)); // reduce cover intersection
				if (!cover.length) break; 
			} else {
				cover = [...set];
			}
		} else {
			let g = UNIQUE.get(cp);
			if (g) {
				// this is the only group with this non-confusable character
				check_group(g, cps);
				return g; 
			}
			free.push(cp);
		}
	}
	if (cover) {
		// we have 1+ confusable
		// if free is empty, this is confusable
		// else, does any other group have all of these characters?
		//       if it does, does it also have the confusables?
		//
		// eg. "0x" vs "0"+cyrl(x)
		// cover: [Latin, Cyrl] <-- at least one
		// free: ["0"]          <-- could be empty!
		for (let i of cover) {
			let g = GROUPS[i];
			if (!free.length || (free.every(cp => g.V.has(cp)) && !confused.every(cp => g.V.has(cp)))) {
				throw new Error(`whole-label confusable`);
			}
		}
	}
	// TODO: is the cover a hint?
	// we didn't have a unique character
	let err0;
	for (let g of GROUPS) {
		if (cps.some(cp => g.P.has(cp))) { // check groups with a primary match
			try {
				check_group(g, cps);
				return g; // take the first one that accepts 
			} catch (err) {
				if (!err0) err0 = err; // remember the first error
			}
		}
	}
	// if error exists, we had 1+ matches
	if (err0) throw err0;
	// we had 0 matches:
	// likely the name was composed of parts, each of which is valid
	// but when nfc'd, it formed a disallowed character
	// eg. valid(a) + ignored + valid(breve) => invalid(a-breve)
	process(cps, x=>x); // should probably throw
	throw new Error(`no match`); // can this happen? hangul parts
}

// throw on first error
function flatten(split) {
	return split.map(({input, error, output}) => {
		// don't print label again if just a single label
		if (error) {
			let msg = error.message;
			throw new Error(split.length == 1 ? msg : `Invalid label "${safe_str_from_cps(input)}": ${msg}`);
		}
		return str_from_cps(output);
	}).join(STOP_CH);
}

function check_group(g, cps) {
	let {V, M} = g;
	for (let cp of cps) {
		if (!V.has(cp)) {
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			let quoted = quoted_cp(cp);
			for (let cp of cps) {
				let u = UNIQUE.get(cp);
				if (u && u !== g) {
					if (!u.R) quoted = `${quoted} is ${u.N}`;
					break;
				}
			}
			throw new Error(`disallowed ${g.N} character: ${quoted}`);
		}
	}
	if (M >= 0) {
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // we know it can't be cm leading
			if (CM.has(cps[i])) {
				let j = i + 1;
				while (j < e && CM.has(cps[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: "${str_from_cps(cps.slice(i-1, j))}" (${j-i}/${M})`);
				}
				i = j;
			}
		}
	}
	// this code currently isn't needed
	/*
	let cm_whitelist = M instanceof Map;
	for (let i = 0, e = cps.length; i < e; ) {
		let cp = cps[i++];
		let seqs = cm_whitelist && M.get(cp);
		if (seqs) { 
			// list of codepoints that can follow
			// if this exists, this will always be 1+
			let j = i;
			while (j < e && CM.has(cps[j])) j++;
			let cms = cps.slice(i, j);
			let match = seqs.find(seq => !compare_arrays(seq, cms));
			if (!match) throw new Error(`disallowed combining mark sequence: "${safe_str_from_cps([cp, ...cms])}"`);
			i = j;
		} else if (!V.has(cp)) {
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			let quoted = quoted_cp(cp);
			for (let cp of cps) {
				let u = UNIQUE.get(cp);
				if (u && u !== g) {
					// if both scripts are restricted this error is confusing
					// because we don't differentiate RestrictedA from RestrictedB 
					if (!u.R) quoted = `${quoted} is ${u.N}`;
					break;
				}
			}
			throw new Error(`disallowed ${g.N} character: ${quoted}`);
			//throw new Error(`disallowed character: ${quoted} (expected ${g.N})`);
			//throw new Error(`${g.N} does not allow: ${quoted}`);
		}
	}
	if (!cm_whitelist) {
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // we know it can't be cm leading
			if (CM.has(cps[i])) {
				let j = i + 1;
				while (j < e && CM.has(cps[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: "${str_from_cps(cps.slice(i-1, j))}" (${j-i}/${M})`);
				}
				i = j;
			}
		}
	}
	*/
}

// given a list of codepoints
// returns a list of lists, where emoji are a fully-qualified (as Array subclass)
// eg. explode_cp("abc💩d") => [[61, 62, 63], Emoji[1F4A9, FE0F], [64]]
function process(input, nf) {
	let ret = [];
	let chars = [];
	input = input.slice().reverse(); // flip so we can pop
	while (input.length) {
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			if (chars.length) {
				ret.push(nf(chars));
				chars = [];
			}
			ret.push(emoji);
		} else {
			let cp = input.pop();
			/*
			let cps = MAPPED.get(cp);
			if (cps) {
				chars.push(...cps);
			} else {
				chars.push(cp);
			}
			*/
			if (VALID.has(cp)) {
				chars.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					chars.push(...cps);
				} else if (!IGNORED.has(cp)) {
					throw new Error(`disallowed character: ${quoted_cp(cp)}`); 
				}
			}
		}
	}
	if (chars.length) {
		ret.push(nf(chars));
	}
	return ret;
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
}

// given array of codepoints
// returns the longest valid emoji sequence (or undefined if no match)
// *MUTATES* the supplied array
// allows optional FE0F
// disallows interleaved ignored characters
// fills (optional) eaten array with matched codepoints
function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let saved;
	let stack = [];
	let pos = cps.length;
	if (eaten) eaten.length = 0; // clear input buffer (if needed)
	while (pos) {
		let cp = cps[--pos];
		node = node.B.find(x => x.Q.has(cp));
		if (!node) break;
		if (node.S) { // remember
			saved = cp;
		} else if (node.C) { // check exclusion
			if (cp === saved) break;
		}
		stack.push(cp);
		if (node.F) {
			stack.push(FE0F);
			if (pos > 0 && cps[pos - 1] == FE0F) pos--; // consume optional FE0F
		}
		if (node.V) { // this is a valid emoji (so far)
			emoji = conform_emoji_copy(stack, node);
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	/*
	if (!emoji) {
		let cp = cps[cps.length-1];
		if (EMOJI_SOLO.has(cp)) {
			if (eaten) eaten.push(cp);
			emoji = Emoji.of(cp);
			cps.pop();
		}
	}
	*/
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = Emoji.from(cps); // copy stack
	if (node.V == 2) copy.splice(1, 1); // delete FE0F at position 1 (see: make.js)
	return copy;
}

// return all supported emoji as fully-qualified emoji 
// ordered by length then lexicographic 
function ens_emoji() {
	//let ret = [...EMOJI_SOLO].map(x => [x]);
	let ret = [];
	build(EMOJI_ROOT, []);
	return ret.sort(compare_arrays);
	function build(node, cps, saved) {
		if (node.S) { 
			saved = cps[cps.length-1];
		} else if (node.C) { 
			if (saved === cps[cps.length-1]) return;
		}
		if (node.F) cps.push(FE0F);
		if (node.V) ret.push(conform_emoji_copy(cps, node));
		for (let br of node.B) {
			for (let cp of br.Q) {
				build(br, [...cps, cp], saved);
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

function ens_tokenize(name, {
	nf = true, // collapse unnormalized runs into a single token
} = {}) {
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({type: TY_EMOJI, emoji, input: eaten.slice(), cps: filter_fe0f(emoji)});
		} else {
			let cp = input.pop();
			if (cp == STOP) {
				tokens.push({type: TY_STOP, cp});
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
	if (nf) {
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
					let cps = nfc(cps0);
					if (compare_arrays(cps, cps0)) { // bundle into an nfc token
						tokens.splice(start, end - start, {type: TY_NFC, input: cps0, cps, tokens: collapse_valid_tokens(slice)});
						i = start;
					} else { 
						i = end - 1; // skip to end of slice
					}
					start = -1; // reset
				} else {
					start = i; // remember last
				}
			} else if (token.type == TY_EMOJI) { // 20221024: is this correct?
				start = -1; // reset
			}
		}
	}
	return collapse_valid_tokens(tokens);
}

function is_valid_or_mapped(type) {
	return type == TY_VALID || type == TY_MAPPED;
}

function requires_check(cps) {
	return cps.some(cp => NFC_CHECK.has(cp));
}

function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type == TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type == TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

function hex_seq(cps) {
	return cps.map(hex_cp).join(' ');
}

function create_arrow_span() {
	let span = document.createElement('span');
	span.classList.add('arrow');
	span.innerHTML = '➔'; //'&rarr;';
	return span;
}

function span_from_cp(cp, in_emoji) {
	let span = document.createElement('span');
	if (cp == 0x200D) {
		span.classList.add('mod', 'zwj');
		span.innerText = 'ZWJ';
	} else if (cp == 0x200C) {
		span.classList.add('mod', 'zwj');
		span.innerText = 'ZWNJ';
	} else if (cp == 0xFE0F) {
		span.classList.add('mod', 'dropped', 'style');
		span.innerText = 'FE0F';
	} else if (cp == 0x20E3) {
		span.classList.add('mod', 'keycap');
		span.innerText = 'Keycap';
	} else if (cp >= 0xE0021 && cp <= 0xE007E) { // printable ascii tag
		span.classList.add('mod', 'tag');
		span.innerText = String.fromCodePoint(cp - 0xE0000);
	} else if (cp == 0xE007F) { // tag end
		span.classList.add('mod', 'tag', 'end');
		span.innerText = '⌫'; // 🏷️
	} else if (!in_emoji && should_escape(cp)) {
		span.classList.add('code');
		span.innerText = hex_cp(cp);
	} else {
		span.innerText = safe_str_from_cps([cp]);
	}
	return span;
}

// idea
//export function dom_from_token(token) {

function format_tooltip(obj, extra) {
	let lines = Object.entries(obj).map(([k, v]) => `${k}: ${v}`);
	if (Array.isArray(extra)) lines.push(...extra);	
	return lines.join('\n');
}

function isolated_safe(cps) {
	return cps.map(cp => safe_str_from_cps([cp])).join('\u{200B}')
}

// TODO: these options are shit, fix this
function dom_from_tokens(tokens, {
	before = false, 
	///isolate = false,
	tld_class = true,
	components = false, 
	emoji_url = 'https://emojipedia.org/%s',
	extra = () => {},
} = {}) {
	let div = document.createElement('div');
	div.classList.add('tokens');
	if (before) {
		// dont use normalized form unless its simple
		tokens = tokens.flatMap(token => {
			if (token.type === 'nfc' && !token.tokens.every(t => t.type == 'valid')) {
				return token.tokens;
			} else {
				return token;
			}
		});
	}
	div.append(...tokens.map((token, i) => {
		let el;
		switch (token.type) {
			case 'emoji': {
				el = document.createElement(emoji_url ? 'a' : 'span');
				if (emoji_url) el.href = emoji_url.replace('%s', String.fromCodePoint(...token.emoji));
				let cps = before ? token.input : token.cps;
				if (components) {
					el.append(...cps.map(cp => span_from_cp(cp, true)));
				} else {
					el.innerText = String.fromCodePoint(...token.emoji); // use fully-qualified form
				}
				el.title = format_tooltip({
					Type: 'Emoji',
					Hex: hex_seq(cps),
					Beautified: hex_seq(token.emoji),
				}, extra(token.type, cps));
				break;
			}
			case 'nfc': {
				el = document.createElement('div');
				if (before) {
					el.innerText = safe_str_from_cps(token.input);
					el.title = format_tooltip({
						Type: 'NFC (Unnormalized)',
						Hex: hex_seq(token.input),
					}, extra(token.type, token.input));
				} else {	
					let lhs = dom_from_tokens(token.tokens, {before, components, emoji_url, extra}); //, isolate: true}); // recursive
					lhs.classList.add('before');
					lhs.title = format_tooltip({
						Type: 'NFC (Unnormalized)',
						Hex: hex_seq(token.input),
					}, extra(token.type, token.input));
					let rhs = document.createElement('div');
					rhs.classList.add('valid');
					rhs.innerText = safe_str_from_cps(token.cps);
					rhs.title = format_tooltip({
						Type: 'NFC (Normalized)',
						Hex: hex_seq(token.cps),
					}, extra(token.type, token.cps));
					el.append(lhs, create_arrow_span(), rhs);
				}
				break;
			}
			case 'valid': {
				el = document.createElement('span');		
				let form = safe_str_from_cps(token.cps);
				if (tld_class && (tokens.length == 1 || (i === tokens.length-1 && tokens[i-1].type === 'stop'))) { 
					// theres just 1 token/or we're the last token with a stop before us
					el.classList.add(form);
				}
				el.innerText = form;
				el.title = format_tooltip({
					Type: 'Valid',
					Hex: hex_seq(token.cps),
				}, extra(token.type, token.cps));
				break;
			}
			case 'mapped': {
				el = document.createElement('div');
				let span_src = document.createElement('span');
				span_src.classList.add('before');
				span_src.innerText = safe_str_from_cps([token.cp]);	// isolate ? isolated_safe([token.cp]) : 
				span_src.title = format_tooltip({
					Type: 'Mapped (Match)',
					Hex: hex_cp(token.cp),
				}, extra(token.type, [token.cp]));
				el.append(span_src);
				if (!before) {
					let span_dst = document.createElement('span');
					span_dst.innerText = isolated_safe(token.cps); // safe_str_from_cps(token.cps);
					span_dst.title = format_tooltip({
						Type: 'Mapped (Replacement)',
						Hex: hex_seq(token.cps),
					}, extra(token.type, token.cps));
					el.append(create_arrow_span(), span_dst);
				}
				break;
			}
			case 'stop':
			case 'ignored':
			case 'disallowed': {
				el = span_from_cp(token.cp);
				el.title = format_tooltip({
					Type: token.type,
					Hex: hex_cp(token.cp),
				}, extra(token.type, [token.cp]));
				break;
			}
			default: throw new TypeError(`unknown token type: ${token.type}`);
		}
		el.classList.add(token.type);
		return el;
	}));
	return div;
}

function use_default_style() {
	let style = document.createElement('style');
	style.innerText = `
	.tokens {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}
	.tokens > * {
		padding: 2px 4px;
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 5px;
	}
	.tokens a {
		text-decoration: none;
	}
	.tokens a:hover {
		outline: 2px solid #00f;
	}
	.tokens .valid {
		background: #cfc;
		border: 2px solid #0a0;
		line-break: anywhere;
	}
	.tokens .valid.eth {
		color: #fff;
		background: #58f;
		border: none;
	}
	.tokens .valid.com {
		color: #fff;
		background: #0a0;
		border: none;
	}
	.tokens .ignored {
		color: #fff;
		background: #aaa;
		font-size: 75%;
		font-family: monospace;
	}
	.tokens .disallowed {
		background: #c00;	
		min-width: 5px;
		min-height: 1em;
		border-radius: 5px;
		color: #fff;
	}
	.tokens .disallowed.code {
		font-size: 75%;
		background: #800;
	}
	.tokens .disallowed.mod {
		border: 2px solid #800;
		font-size: 80%;
	}
	.tokens .disallowed.mod.tag {
		background: #f00;
		color: #000;
	}
	.tokens .mapped {
		display: flex;
		border: 2px solid #66f;
		background: #ccf;
	}
	.tokens .mapped span:first-child {
		margin-bottom: -4px;
		border-bottom: 4px solid #000;
		text-align: center;
		min-width: 0.5rem;
	}
	.tokens .stop {
		font-weight: bold;
		background: linear-gradient(#fff, #ff0);
		padding-bottom: 0;
	}
	.tokens .emoji {
		border: 2px solid #0aa;
		background: #cff;
		margin: 0 2px;
		color: #000;
	}
	.tokens .mod {
		color: #fff;
	}
	.tokens * .mod {
		font-size: 70%;
		padding: 2px;
		border-radius: 3px;
	}
	.tokens .emoji .mod {
		background: #333;
	}
	.tokens .emoji .mod.zwj {
		background: #0aa;
	}
	.tokens .emoji .mod.tag {
		background: #0aa;
	}
	.tokens .emoji .mod.tag.end {
		background: #066;
	}
	.tokens .emoji .mod.dropped {
		background: #aaa;		
	}
	.tokens .arrow {
		color: rgba(0, 0, 0, 0.35);
	}
	.tokens .code {
		font-family: monospace;
	}
	.tokens .nfc {
		display: flex;
		border: 2px solid #c80;
		background: #fd8;
		border-radius: 5px;
	}
	.tokens .nfc > .valid {
		background: none;
		border: none;
	}`;
	document.body.append(style);
}

export { compare_arrays, dom_from_tokens, ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, explode_cp, hex_cp, is_combining_mark, nfc, nfd, quote_cp, random_choice, random_sample, run_tests, safe_str_from_cps, should_escape, str_from_cps, use_default_style };
