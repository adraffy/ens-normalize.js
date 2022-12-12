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

// created 2022-12-12T03:45:54.950Z
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

// created 2022-12-12T03:45:55.063Z
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
							input: cps0, // there are 3 states: tokens0 ==(process)=> input ==(nfc)=> tokens/cps
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
	tld_class = true,
	components = false, 
	emoji_url = 'https://emojipedia.org/%s',
	extra = () => {},
} = {}) {
	let div = document.createElement('div');
	div.classList.add('tokens');
	/*
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
	*/
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
				// get the cps from the original tokens
				let cps0 = token.tokens0.flatMap(t => t.type === 'valid' ? t.cps : t.cp); // this can only be mapped/ignored/valid
				// break every valid token into individual characters
				let lhs = dom_from_tokens(token.tokens0.flatMap(t => t.type === 'valid' ? t.cps.map(cp => ({type: 'valid', cps: [cp]})) : t), {components, before, emoji_url, extra});
				lhs.title = format_tooltip({
					Type: 'NFC (Unnormalized)',
					Hex: hex_seq(cps0),
				}, extra(token.type, cps0));
				el.append(lhs);
				if (!before) {
					let rhs = dom_from_tokens(token.tokens, {components, emoji_url, extra});
					rhs.title = format_tooltip({
						Type: 'NFC (Normalized)',
						Hex: hex_seq(token.cps),
					}, extra(token.type, token.cps));
					el.append(create_arrow_span(), rhs);
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
	}`;
	document.body.append(style);
}

export { compare_arrays, dom_from_tokens, ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, explode_cp, hex_cp, is_combining_mark, nfc, nfd, quote_cp, random_choice, random_sample, run_tests, safe_str_from_cps, should_escape, str_from_cps, use_default_style };
