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

// created 2022-12-05T00:28:25.581Z
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

// created 2022-12-05T00:28:25.688Z
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
