'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

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

// created 2023-01-26T08:54:35.886Z
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
	let n = a.length;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

// created 2023-01-26T08:54:36.002Z
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
const HYPHEN = 0x2D;

function read_set() {
	return new Set(read_sorted(r$1));
}
const MAPPED = new Map(read_mapped(r$1)); 
const IGNORED = read_set(); // ignored characters are not valid, so just read raw codepoints
/*
// direct include from payload is smaller that the decompression code
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
	// deduplicated sets + uniques
	return new Set([read_sorted(r$1).map(i => CHUNKS[i]), read_sorted(r$1)].flat(2));
}
const UNRESTRICTED = r$1();
const GROUPS = read_array_while(i => {
	// minifier property mangling seems unsafe
	// so these are manually renamed to single chars
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
// decode compressed wholes
[...WHOLE_VALID, ...read_set()].sort((a, b) => a-b).map((cp, i, v) => {
	let d = r$1(); 
	let w = v[i] = d ? v[i-d] : {V: [], M: new Map()};
	w.V.push(cp); // add to member set
	if (!WHOLE_VALID.has(cp)) {
		WHOLE_MAP.set(cp, w);  // register with whole map
	}
});
// compute confusable-extent complements
for (let {V, M} of new Set(WHOLE_MAP.values())) {
	// connect all groups that have each whole character
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
	// per character cache groups which are not a member of the extent
	let union = recs.flatMap(({G}) => [...G]);
	for (let {G, V} of recs) {
		let complement = new Set(union.filter(g => !G.has(g)));
		for (let cp of V) {
			M.set(cp, complement);
		}
	}
}
let union = new Set(); // exists in 1+ groups
let multi = new Set(); // exists in 2+ groups
for (let g of GROUPS) {
	for (let cp of g.V) {
		(union.has(cp) ? multi : union).add(cp);
	}
}
// dual purpose WHOLE_MAP: return placeholder if unique non-confusable
for (let cp of union) {
	if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}
const VALID = new Set([...union, ...nfd(union)]); // possibly valid

// decode emoji
const EMOJI_SORTED = read_sorted(r$1);
//const EMOJI_SOLO = new Set(read_sorted(r).map(i => EMOJI_SORTED[i])); // not needed
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

// note: set(s) cannot be exposed because they can be modified
function is_combining_mark(cp) {
	return CM.has(cp);
}
function should_escape(cp) {
	return ESCAPE.has(cp);
}

function ens_normalize_fragment(frag, decompose) {
	let nf = decompose ? nfd : nfc;
	return frag.split(STOP_CH).map(label => str_from_cps(process(explode_cp(label), nf).flatMap(x => x.is_emoji ? filter_fe0f(x) : x))).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(ens_split(name));
}

function ens_beautify(name) {
	let split = ens_split(name, true);
	// this is experimental
	for (let {type, output, error} of split) {
		if (error) continue;

		// replace leading/trailing hyphen
		// 20230121: consider beautifing all or leading/trailing hyphen to unicode variant
		// not exactly the same in every font, but very similar: "-" vs "‐"
		/*
		const UNICODE_HYPHEN = 0x2010;
		// maybe this should replace all for visual consistancy?
		// `node tools/reg-count.js regex ^-\{2,\}` => 592
		//for (let i = 0; i < output.length; i++) if (output[i] == 0x2D) output[i] = 0x2010;
		if (output[0] == HYPHEN) output[0] = UNICODE_HYPHEN;
		let end = output.length-1;
		if (output[end] == HYPHEN) output[end] = UNICODE_HYPHEN;
		*/
		// 20230123: WHATWG URL uses "CheckHyphens" false
		// https://url.spec.whatwg.org/#idna

		// ξ => Ξ if not greek
		if (type !== 'Greek') { 
			let prev = 0;
			while (true) {
				let next = output.indexOf(0x3BE, prev);
				if (next < 0) break;
				output[next] = 0x39E; 
				prev = next + 1;
			}
		}

		// 20221213: fixes bidi subdomain issue, but breaks invariant (200E is disallowed)
		// could be fixed with special case for: 2D (.) + 200E (LTR)
		//output.splice(0, 0, 0x200E);
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
				// 20230120: change to strict
				// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/59
				//norm = [];
				//type = 'None'; // use this instead of next match, "ASCII"
				throw new Error(`empty label`);
			} else {
				let chars = tokens[0];
				let emoji = token_count > 1 || chars.is_emoji;
				if (!emoji && chars.every(cp => cp < 0x80)) { // special case for ascii
					norm = chars;
					check_leading_underscore(norm);
					// only needed for ascii
					// 20230123: matches matches WHATWG, see note 3.3
					check_label_extension(norm);
					// cant have fenced
					// cant have cm
					// cant have wholes
					// see derive: assert ascii fast path
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
						let [g] = determine_group(unique); // take the first match
						// see derive: "Matching Groups have Same CM Style"
						// alternative: could form a hybrid type: Latin/Japanese/...	
						check_group(g, chars); // need text in order
						check_whole(g, unique); // only need unique text (order would be required for multiple-char confusables)
						type = g.N;
						// 20230121: consider exposing restricted flag
						// it's simpler to just check for 'Restricted'
						// or even better: type.endsWith(']')
						//if (g.R) info.restricted = true;
					}
				}
			}
			info.type = type;
		} catch (err) {
			info.error = err; // use full error object
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

exports.ens_beautify = ens_beautify;
exports.ens_emoji = ens_emoji;
exports.ens_normalize = ens_normalize;
exports.ens_normalize_fragment = ens_normalize_fragment;
exports.ens_split = ens_split;
exports.ens_tokenize = ens_tokenize;
exports.is_combining_mark = is_combining_mark;
exports.nfc = nfc;
exports.nfd = nfd;
exports.safe_str_from_cps = safe_str_from_cps;
exports.should_escape = should_escape;
