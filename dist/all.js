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

// created 2022-11-28T06:03:38.144Z
var r$1 = read_compressed_payload('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');
const FENCED = new Map([[8217,"apostrophe"],[8260,"fraction slash"],[12539,"middle dot"]]);

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

// created 2022-11-28T06:03:38.253Z
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

// note: cps can be iterable
function nfd(cps) {
	return decomposed(cps).map(unpack_cp);
}
function nfc(cps) {
	return composed_from_decomposed(decomposed(cps));
}

//const t0 = performance.now();

const STOP = 0x2E;
const FE0F = 0xFE0F;
const STOP_CH = '.';
const UNIQUE_PH = 1;

function read_set() {
	return new Set(read_sorted(r$1));
}
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
const UNRESTRICTED = r$1();
const GROUPS = read_array_while(i => {
	let N = read_array_while(r$1).map(x => x+0x60);
	if (N.length) {
		let R = i >= UNRESTRICTED; // first arent restricted
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
const WHOLE_VALID = read_set();
const WHOLE_MAP = new Map();
[...WHOLE_VALID, ...read_set()].sort((a, b) => a-b).map((cp, i, v) => {
	let d = r$1(); 
	let w = v[i] = d ? v[i-d] : {V: [], M: new Map()};
	w.V.push(cp);
	if (!WHOLE_VALID.has(cp)) {
		WHOLE_MAP.set(cp, w); 
	}
});
for (let {V, M} of new Set(WHOLE_MAP.values())) {
	let recs = [];
	for (let cp of V) {
		let gs = GROUPS.filter(g => g.V.has(cp));
		let rec = recs.find(({G}) => gs.some(g => G.has(g)));
		if (!rec) {
			rec = {G: new Set(), V: []};
			recs.push(rec);
		}
		rec.V.push(cp);
		gs.forEach(g => rec.G.add(g));
	}	
	let union = recs.flatMap(({G}) => [...G]);
	for (let {G, V} of recs) {
		let complement = new Set(union.filter(g => !G.has(g)));
		for (let cp of V) {
			M.set(cp, complement);
		}
	}
}
let union = new Set();
let multi = new Set();
for (let g of GROUPS) {
	for (let cp of g.V) {
		(union.has(cp) ? multi : union).add(cp);
	}
}
for (let cp of union) {
	if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}
/*
// this is too slow, 500ms+
let valid_union = [...new Set(GROUPS.flatMap(g => [...g.V]))];
for (let cp of valid_union) {
	if (!WHOLE_MAP.has(cp) && GROUPS.filter(g => g.V.has(cp)).length == 1) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}
*/
const VALID = new Set([...union, ...nfd(union)]); // 30ms
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
//console.log(performance.now() - t0);

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
	let prev = FENCED.get(cp);
	if (prev) throw error_placement(`leading ${prev}`);
	let n = cps.length;
	let last = -1;
	for (let i = 1; i < n; i++) {
		cp = cps[i];
		let match = FENCED.get(cp);
		if (match) {
			if (last == i) throw error_placement(`${prev} + ${match}`);
			last = i + 1;
			prev = match;
		}
	}
	if (last == n) throw error_placement(`trailing ${prev}`);
}

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
	for (let {type, output, error} of split) {
		if (!error && type !== 'Greek') { // ξ => Ξ if not greek
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
					// cant have fenced
					// cant have cm
					// cant have wholes
					type = 'ASCII';
				} else {
					if (emoji) { // there is at least one emoji
						info.emoji = true; 
						chars = tokens.flatMap(x => x.is_emoji ? [] : x); // all of the nfc tokens concat together
					}
					norm = tokens.flatMap(x => !preserve_emoji && x.is_emoji ? filter_fe0f(x) : x);
					check_leading_underscore(norm);
					if (!chars.length) { // theres no text, just emoji
						type = 'Emoji';
					} else {
						if (CM.has(norm[0])) throw error_placement('leading combining mark');
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								throw error_placement(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`);
							}
						}
						check_fenced(norm);
						let unique = [...new Set(chars)];
						let [g] = determine_group(unique);
						check_group(g, chars);
						check_whole(g, unique);
						type = g.N;
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

function check_whole(group, unique) {
	let maker;
	let shared = []; // TODO: can this be avoided?
	for (let cp of unique) {
		let whole = WHOLE_MAP.get(cp);
		if (whole === UNIQUE_PH) return; // unique, non-confusable
		if (whole) {
			let set = whole.M.get(cp); // groups which have a character that look-like this character
			maker = maker ? maker.filter(g => set.has(g)) : [...set];
			if (!maker.length) return; // confusable intersection is empty
		} else {
			shared.push(cp); 
		}
	}
	if (maker) {
		// we have 1+ confusable
		// check if any of the remaning groups
		// contain the shared characters too
		for (let g of maker) {
			if (shared.every(cp => g.V.has(cp))) {
				throw new Error(`whole-script confusable: ${group.N}/${g.N}`);
			}
		}
	}
}

// assumption: unique.size > 0
// returns list of matching groups
function determine_group(unique) {
	let groups = GROUPS;
	for (let cp of unique) {
		// note: we need to dodge CM that are whitelisted
		// but that code isn't currently necessary
		let gs = groups.filter(g => g.V.has(cp));
		if (!gs.length) {
			if (groups === GROUPS) {
				// the character was composed of valid parts
				// but it's NFC form is invalid
				throw error_disallowed(cp); // this should be rare
			} else {
				// there is no group that contains all these characters
				// throw using the highest priority group that matched
				// https://www.unicode.org/reports/tr39/#mixed_script_confusables
				throw error_group_member(groups[0], cp);
			}
		}
		groups = gs;
		if (gs.length == 1) break; // there is only one group left
	}
	// there are at least 1 group(s) with all of these characters
	return groups;
}

// throw on first error
function flatten(split) {
	return split.map(({input, error, output}) => {
		if (error) {
			// don't print label again if just a single label
			let msg = error.message;
			throw new Error(split.length == 1 ? msg : `Invalid label "${safe_str_from_cps(input)}": ${msg}`);
		}
		return str_from_cps(output);
	}).join(STOP_CH);
}


function error_disallowed(cp) {
	// TODO: add cp to error?
	return new Error(`disallowed character: ${quoted_cp(cp)}`); 
}
function error_group_member(g, cp) {
	let quoted = quoted_cp(cp);
	let gg = GROUPS.find(g => g.P.has(cp));
	if (gg) {
		quoted = `${gg.N} ${quoted}`;
	}
	return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}
function error_placement(where) {
	return new Error(`illegal placement: ${where}`);
}

// assumption: cps.length > 0
// assumption: cps[0] isn't a CM
function check_group(g, cps) {
	let {V, M} = g;
	/*
	for (let i = 0; i < cps.length; i++) {
		let cp = cps[i];
		if (!V.has(cp)) {
			if (CM.has(cp)) {
				throw new Error(`disallowed combining mark: "${str_from_cps([cps[i-1], cp])}" ${quote_cp(cp)}`);
			} else {
				throw error_group_member(g, cp);
			}
		}
	}
	*/
	for (let cp of cps) {
		if (!V.has(cp)) {
			throw error_group_member(g, cp);
		}
	}
	if (M >= 0) {
		// we know it can't be cm leading
		// we know the previous character isn't an emoji
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) {
			if (CM.has(cps[i])) {
				let j = i + 1;
				while (j < e && CM.has(cps[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: ${g.N} "${str_from_cps(cps.slice(i-1, j))}" (${j-i}/${M})`);
				}
				i = j;
			}
		}
	}
	// *** this code currently isn't needed ***
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
			if (VALID.has(cp)) {
				chars.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					chars.push(...cps);
				} else if (!IGNORED.has(cp)) {
					throw error_disallowed(cp);
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
	// *** this code currently isn't needed ***
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
	// *** this code currently isn't needed ***
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
						tokens.splice(start, end - start, {
							type: TY_NFC, 
							input: cps0, 
							cps, 
							tokens0: collapse_valid_tokens(slice),
							tokens: ens_tokenize(str_from_cps(cps), {nf: false})
						});
						i = start;
					} else { 
						i = end - 1; // skip to end of slice
					}
					start = -1; // reset
				} else {
					start = i; // remember last
				}
			} else if (token.type !== TY_IGNORED) { // 20221024: is this correct?
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
	span.innerHTML = '➔'; // '→'; 
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
					let lhs = dom_from_tokens(token.tokens0, {components, emoji_url, extra});					if (token.tokens0.every(x => x.type === 'valid')) { // trival case hack
						lhs.querySelector('.valid').innerHTML = token.input.map(cp => safe_str_from_cps([cp])).join('<span>+</span>');
					}
					lhs.classList.add('before');
					lhs.title = format_tooltip({
						Type: 'NFC (Unnormalized)',
						Hex: hex_seq(token.input),
					}, extra(token.type, token.input));
					let rhs = dom_from_tokens(token.tokens, {components, emoji_url, extra});
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
				if (tld_class && (tokens.length == 1 || (i === tokens.length-1 && tokens[i-1].type === 'stop')) && /[a-z]/.test(form)) { 
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
		overflow: hidden;
	}
	.tokens a {
		text-decoration: none;
	}
	.tokens a:hover {
		border-color: #00f;
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
		border: 1px solid #ccc;
	}
	.tokens .emoji {
		border: 2px solid #0aa;
		background: #cff;
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
		padding: 2px;
	}
	.tokens .nfc .before .valid span {
		color: rgba(0, 0, 0, 0.35);
	}`;
	document.body.append(style);
}

export { compare_arrays, dom_from_tokens, ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, explode_cp, hex_cp, is_combining_mark, nfc, nfd, quote_cp, random_choice, random_sample, run_tests, safe_str_from_cps, should_escape, str_from_cps, use_default_style };
