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

// created 2022-11-14T08:36:22.169Z
var r$1 = read_compressed_payload('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');

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

// created 2022-11-14T08:36:22.278Z
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
function read_str(n) {
	return str_from_cps(read_deltas(n, r$1));
}

const MAPPED = new Map(read_mapped(r$1)); 
const IGNORED = read_set(); // ignored characters are not valid, so just read raw codepoints
const FENCED = new Map(read_array_while(() => {
	let cp = r$1();
	if (cp) return [cp, read_str(r$1())];
}));
const CM = read_set();
const ESCAPE = read_set(); // characters that should not be printed
const NFC_CHECK = read_set();
const CHUNKS = read_sorted_arrays(r$1);
function read_chunked() {
	return new Set([read_sorted(r$1).map(i => CHUNKS[i]), read_sorted(r$1)].flat(2));
}
const GROUPS = read_array_while(() => {
	let N = r$1();
	if (N) {
		let R = N==1;
		N = R ? 'Restricted' : read_str(N-1);
		let P = read_chunked(); // primary
		let Q = read_chunked(); // secondary
		let V = [...P, ...Q].sort((a, b) => a-b); // valid (sorted)
		let W = read_sorted_arrays(r$1).map(v => new Set(v.map(i => V[i]))); // whole (sets)
		let M = r$1()-1; // combining mark
		if (M < 0) { // whitelisted
			M = new Map(read_array_while(() => {
				let i = r$1();
				if (i) return [V[i-1], read_array_while(() => {
					let v = read_array_while(r$1);
					if (v.length) return v.map(x => x-1);
				})];
			}));
		}
		return {N, P, W, M, R, V: new Set(V)};
	}
});
const EMOJI_SORTED = read_sorted(r$1);
const EMOJI_SOLO = new Set(read_sorted(r$1).map(i => EMOJI_SORTED[i]));
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
	for (let {script, output} of split) {
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
					check_label_extension(norm); // only needed for ascii
					type = 'ASCII';
				} else {
					if (emoji) { // there is at least one emoji
						info.emoji = true; 
						chars = tokens.flatMap(x => x.is_emoji ? [] : x); // all of the nfc tokens concat together
					}
					norm = tokens.flatMap(x => !preserve_emoji && x.is_emoji ? filter_fe0f(x) : x);
					if (!chars.length) {
						type = 'Emoji';
					} else {
						check_leading_combining_mark(norm);
						check_fenced(norm);
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								throw new Error(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[i][0]])}"`);
							}
						}
						type = determine_group(chars).N;
					}
				}
				check_leading_underscore(norm);
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
	for (let cp of cps) {
		let g = UNIQUE.get(cp);
		if (g) { 
			// we got a unique character match
			// either we are member of this group or throw
			check_group(g, cps);
			return g;
		}
	}
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
	throw new Error(`no match`); // can this happen?
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
	let {V, W, M} = g;
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
				if (j - i >= M) {
					throw new Error(`too many combining marks: "${str_from_cps(cps.slice(i-1, j))}" (max: ${M})`);
				}
				i = j;
			}
		}
	}
	// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
	for (let set of W) {
		if (cps.every(cp => set.has(cp))) {
			throw new Error(`spoofable`);
		}
	}
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
	if (!emoji) {
		let cp = cps[cps.length-1];
		if (EMOJI_SOLO.has(cp)) {
			if (eaten) eaten.push(cp);
			emoji = Emoji.of(cp);
			cps.pop();
		}
	}
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
	let ret = [...EMOJI_SOLO].map(x => [x]);
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

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, is_combining_mark, nfc, nfd, safe_str_from_cps, should_escape };
