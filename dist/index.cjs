'use strict';

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
// 20220922: added for https://github.com/adraffy/ens-normalize.js/issues/4
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


function read_trie(next) {
	let ret = [];
	let sorted = read_sorted(next); 
	expand(decode([]), []);
	return ret; // not sorted
	function decode(Q) { // characters that lead into this node
		let S = next(); // state: valid, save, check
		let B = read_array_while(() => { // buckets leading to new nodes
			let cps = read_sorted(next).map(i => sorted[i]);
			if (cps.length) return decode(cps);
		});
		return {S, B, Q};
	}
	function expand({S, B}, cps, saved) {
		if (S & 4 && saved === cps[cps.length-1]) return;
		if (S & 2) saved = cps[cps.length-1];
		if (S & 1) ret.push(cps); 
		for (let br of B) {
			for (let cp of br.Q) {
				expand(br, [...cps, cp], saved);
			}
		}
	}
}

// created 2023-08-15T23:46:51.241Z
// compressed base64-encoded blob for include-ens data
// source: https://github.com/adraffy/ens-normalize.js/blob/main/src/make.js
// see: https://github.com/adraffy/ens-normalize.js#security
// SHA-256: fe1e4fbc60d6295ba5cded4b33ea016ce07e7510276b620ee481643ca245bbe5
var r$1 = read_compressed_payload('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');
const FENCED = new Map([[8217,"apostrophe"],[8260,"fraction slash"],[12539,"middle dot"]]);
const NSM_MAX = 4;

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

// created 2023-08-15T23:46:51.241Z
// compressed base64-encoded blob for include-nf data
// source: https://github.com/adraffy/ens-normalize.js/blob/main/src/make.js
// see: https://github.com/adraffy/ens-normalize.js#security
// SHA-256: a974b6f8541fc29d919bc85118af0a44015851fab5343f8679cb31be2bdb209e
var r = read_compressed_payload('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');

// https://unicode.org/reports/tr15/
// for reference implementation
// see: /derive/nf.js


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

//console.time('init');

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
// 20230217: we still need all CM for proper error formatting
// but norm only needs NSM subset that are potentially-valid
const CM = read_set();
const NSM = new Set(read_sorted(r$1).map(function(i) { return this[i]; }, [...CM]));
/*
const CM_SORTED = read_sorted(r);
const NSM = new Set(read_sorted(r).map(i => CM_SORTED[i]));
const CM = new Set(CM_SORTED);
*/
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
		//let M = r()-1; // combining mark
		let M = !r$1(); // not-whitelisted, check for NSM
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
class Emoji extends Array {
	get is_emoji() { return true; } // free tagging system
}
// 20230719: emoji are now fully-expanded to avoid quirk logic 
const EMOJI_LIST = read_trie(r$1).map(v => Emoji.from(v)).sort(compare_arrays);
const EMOJI_ROOT = new Map(); // this has approx 7K nodes (2+ per emoji)
for (let cps of EMOJI_LIST) {
	// 20230719: change to *slightly* stricter algorithm which disallows 
	// insertion of misplaced FE0F in emoji sequences (matching ENSIP-15)
	// example: beautified [A B] (eg. flag emoji) 
	//  before: allow: [A FE0F B], error: [A FE0F FE0F B] 
	//   after: error: both
	// note: this code now matches ENSNormalize.{cs,java} logic
	let prev = [EMOJI_ROOT];
	for (let cp of cps) {
		let next = prev.map(node => {
			let child = node.get(cp);
			if (!child) {
				// should this be object? 
				// (most have 1-2 items, few have many)
				// 20230719: no, v8 default map is 4?
				child = new Map();
				node.set(cp, child);
			}
			return child;
		});
		if (cp === FE0F) {
			prev.push(...next);
		} else {
			prev = next;
		}
	}
	for (let x of prev) {
		x.V = cps;
	}
}
//console.timeEnd('init');

// create a safe to print string 
// invisibles are escaped
// leading cm uses placeholder
// quoter(cp) => string, eg. 3000 => "{3000}"
// note: in html, you'd call this function then replace [<>&] with entities
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
	return (should_escape(cp) ? '' : `${bidi_qq(safe_str_from_cps([cp]))} `) + quote_cp(cp);
}

// 20230211: some messages can be mixed-directional and result in spillover
// use 200E after a quoted string to force the remainder of a string from 
// acquring the direction of the quote
// https://www.w3.org/International/questions/qa-bidi-unicode-controls#exceptions
function bidi_qq(s) {
	return `"${s}"\u200E`; // strong LTR
}

function check_label_extension(cps) {
	if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
		throw new Error(`invalid label extension: "${str_from_cps(cps.slice(0, 4))}"`);
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
	let last = -1; // prevents trailing from throwing
	for (let i = 1; i < n; i++) {
		cp = cps[i];
		let match = FENCED.get(cp);
		if (match) {
			// since cps[0] isn't fenced, cps[1] cannot throw
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

// return all supported emoji as fully-qualified emoji 
// ordered by length then lexicographic 
function ens_emoji() {
	return EMOJI_LIST.map(x => x.slice()); // emoji are exposed so copy
}

function ens_normalize_fragment(frag, decompose) {
	let nf = decompose ? nfd : nfc;
	return frag.split(STOP_CH).map(label => str_from_cps(process(explode_cp(label), nf, filter_fe0f).flat())).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(split(name, nfc, filter_fe0f));
}

function ens_beautify(name) {
	let labels = split(name, nfc, x => x); // emoji not exposed
	for (let {type, output, error} of labels) {
		if (error) break; // flatten will throw

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

		// update ethereum symbol
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
	return flatten(labels);
}

function ens_split(name, preserve_emoji) {
	return split(name, nfc, preserve_emoji ? x => x.slice() : filter_fe0f); // emoji are exposed so copy
}

function split(name, nf, ef) {
	if (!name) return []; // 20230719: empty name allowance
	let offset = 0;
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// 4.) "The label must not contain a U+002E ( . ) FULL STOP."
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint, not substring!
		};
		offset += input.length + 1; // + stop
		let norm;
		try {
			// 1.) "The label must be in Unicode Normalization Form NFC"
			let tokens = info.tokens = process(input, nf, ef); // if we parse, we get [norm and mapped]
			let token_count = tokens.length;
			let type;
			if (!token_count) { // the label was effectively empty (could of had ignored characters)
				// 20230120: change to strict
				// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/59
				//norm = [];
				//type = 'None'; // use this instead of next match, "ASCII"
				throw new Error(`empty label`);
			} else {
				norm = tokens.flat();
				check_leading_underscore(norm);
				let emoji = info.emoji = token_count > 1 || tokens[0].is_emoji;
				if (!emoji && norm.every(cp => cp < 0x80)) { // special case for ascii
					// only needed for ascii
					// 20230123: matches matches WHATWG, see note 3.3
					check_label_extension(norm);
					// cant have fenced
					// cant have cm
					// cant have wholes
					// see derive: "Fastpath ASCII"
					type = 'ASCII';
				} else {
					let chars = tokens.flatMap(x => x.is_emoji ? [] : x); // all of the nfc tokens concat together
					if (!chars.length) { // theres no text, just emoji
						type = 'Emoji';
					} else {
						// 5. "The label must not begin with a combining mark, that is: General_Category=Mark."
						if (CM.has(norm[0])) throw error_placement('leading combining mark');
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								// bidi_qq() not needed since emoji is LTR and cps is a CM
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
	let shared = [];
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
		// check if any of the remaining groups
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
			if (!GROUPS.some(g => g.V.has(cp))) { 
				// the character was composed of valid parts
				// but it's NFC form is invalid
				// 20230716: change to more exact statement, see: ENSNormalize.{cs,java}
				// note: this doesn't have to be a composition
				// 20230720: change to full check
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
			// bidi_qq() only necessary if msg is digits
			throw new Error(split.length == 1 ? msg : `Invalid label ${bidi_qq(safe_str_from_cps(input))}: ${msg}`); 
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
// assumption: the previous character isn't an emoji
function check_group(g, cps) {
	let {V, M} = g;
	for (let cp of cps) {
		if (!V.has(cp)) {
			// for whitelisted scripts, this will throw illegal mixture on invalid cm, eg. "e{300}{300}"
			// at the moment, it's unnecessary to introduce an extra error type
			// until there exists a whitelisted multi-character
			//   eg. if (M < 0 && is_combining_mark(cp)) { ... }
			// there are 3 cases:
			//   1. illegal cm for wrong group => mixture error
			//   2. illegal cm for same group => cm error
			//       requires set of whitelist cm per group: 
			//        eg. new Set([...g.V].flatMap(nfc).filter(cp => CM.has(cp)))
			//   3. wrong group => mixture error
			throw error_group_member(g, cp);
		}
	}
	//if (M >= 0) { // we have a known fixed cm count
	if (M) { // we need to check for NSM
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // see: assumption
			// 20230210: bugfix: using cps instead of decomposed h/t Carbon225
			/*
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: ${g.N} ${bidi_qq(str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${M})`);
				}
				i = j;
			}
			*/
			// 20230217: switch to NSM counting
			// https://www.unicode.org/reports/tr39/#Optional_Detection
			if (NSM.has(decomposed[i])) {
				let j = i + 1;
				for (let cp; j < e && NSM.has(cp = decomposed[j]); j++) {
					// a. Forbid sequences of the same nonspacing mark.
					for (let k = i; k < j; k++) { // O(n^2) but n < 100
						if (decomposed[k] == cp) {
							throw new Error(`duplicate non-spacing marks: ${quoted_cp(cp)}`);
						}
					}
				}
				// parse to end so we have full nsm count
				// b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
				if (j - i > NSM_MAX) {
					// note: this slice starts with a base char or spacing-mark cm
					throw new Error(`excessive non-spacing marks: ${bidi_qq(safe_str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${NSM_MAX})`);
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
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: "${str_from_cps(decomposed.slice(i-1, j))}" (${j-i}/${M})`);
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
function process(input, nf, ef) {
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
			ret.push(ef(emoji));
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
// disallows interleaved ignored characters
// fills (optional) eaten array with matched codepoints
function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let pos = cps.length;
	while (pos) {
		node = node.get(cps[--pos]);
		if (!node) break;
		let {V} = node;
		if (V) { // this is a valid emoji (so far)
			emoji = V;
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	return emoji;
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
			tokens.push({
				type: TY_EMOJI, 
				emoji: emoji.slice(), // copy emoji
				input: eaten, 
				cps: filter_fe0f(emoji)
			});
			eaten = []; // reset buffer
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
