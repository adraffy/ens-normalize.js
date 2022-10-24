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

// read a list of non-empty lists
// where 0 is terminal
// [1 0 1 2 0 0] => [[1],[1,2]]
function read_sequences(next) {
	return read_array_while(() => {
		let v = read_array_while(next);
		if (v.length) return v.map(x => x - 1);
	});
}

// created 2022-10-24T09:58:33.586Z
var r$1 = read_compressed_payload('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');
const ORDERED_SCRIPTS = [{"name":"Korean","test":[1],"rest":[0,2]},{"name":"Japanese","test":[3,4],"rest":[0,2]},{"name":"Han","test":[2],"rest":[0]},{"name":"Latin","test":[5],"rest":[0]},{"name":"Cyrillic","test":[6],"rest":[0]},{"name":"Greek","test":[7],"rest":[0]},{"name":"Arabic","test":[8],"rest":[]},{"name":"Devanagari","test":[9],"rest":[]},{"name":"Hebrew","test":[10],"rest":[]},{"name":"Thai","test":[11],"rest":[]}];

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

// created 2022-10-24T09:58:33.652Z
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
function read_set(lookup) {
	return new Set(read_member_array(r$1, lookup));
}
function read_valid_subset() {
	return read_set(SORTED_VALID);
}
function read_valid_subsets() {
	return read_array_while(() => { 
		let v = read_valid_subset();
		if (v.size) return v;
	});
}
const VALID = new Set(SORTED_VALID);
const IGNORED = read_set();
const MAPPED = new Map(read_mapped(r$1));
const CM = read_valid_subset();
const CM_ISOLATED_PH = [];
const CM_WHITELIST = new Map([
	read_array_while(() => {
		let cp = r$1();
		if (cp) return [cp, read_sequences(r$1)];
	}),
	read_member_array(r$1, SORTED_VALID).map(cp => [cp, CM_ISOLATED_PH]),
].flat());
const SCRIPTS = read_valid_subsets(); // [0] is ALL
const ORDERED = ORDERED_SCRIPTS.map(({name, test, rest}) => {
	test = test.map(i => SCRIPTS[i]);
	rest = [test, rest.map(i => SCRIPTS[i])].flat();
	return {name, test, rest, extra: read_valid_subset(), wholes: read_valid_subset()};
});
const RESTRICTED_WHOLES = read_valid_subset();
const RESTRICTED = read_valid_subsets();
const EMOJI_SOLO = read_set();
const EMOJI_ROOT = read_emoji_trie(r$1);
const NFC_CHECK = read_valid_subset();
const ESCAPE = read_set();
const CM_INVALID = read_set();

const STOP = 0x2E;
const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const FE0F = 0xFE0F;

const COMMON = 'Common';
const STOP_CH = str_from_cps([STOP]);

function check_leading_underscore(cps) {
	let e = cps.lastIndexOf(UNDERSCORE);
	for (let i = e; i > 0; ) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error(`underscore allowed only at start`);
		}
	}
	return e + 1;
}

function safe_str_from_cps(cps, quoter = quote_cp) {
	let buf = [];
	if (is_printable_mark(cps[0])) buf.push('◌');
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

/*
// ContextO: MIDDLE DOT
// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
// Between 'l' (U+006C) characters only, used to permit the Catalan character ela geminada to be expressed.
// note: this a lot of effort for 1 character
// 20221020: disabled
function check_middle_dot(cps) {
	let i = 0;
	while (true) {
		i = cps.indexOf(0xB7, i);
		if (i == -1) break;
		if (cps[i-1] !== 0x6C || cps[i+1] !== 0x6C) throw new Error('ContextO: middle dot');
		i += 2;
	}
}
*/

function check_scripts(cps) {
	for (let {name, test, rest, extra, wholes} of ORDERED) {
		if (cps.some(cp => test.some(set => set.has(cp)))) {
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			let bad = cps.filter(cp => !rest.some(set => set.has(cp)) && !extra.has(cp));
			if (bad.length) {
				throw new Error(`mixed-script ${name} confusable: "${str_from_cps(bad)}"`);
			}
			// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
			if (cps.every(cp => wholes.has(cp) || SCRIPTS[0].has(cp))) {
				throw new Error(`whole-script ${name} confusable`);
			}
			return name;
		}
	}
	return COMMON;
}

// requires decomposed codepoints
// returns true if pure (emoji or single script)
function check_restricted_scripts(cps) {
	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	cps = cps.filter(cp => cp != FE0F); // remove emoji (once)
	if (!cps.length) return true; // purely emoji
	for (let set of RESTRICTED) {
		if (cps.some(cp => set.has(cp))) { // first with one match
			if (!cps.every(cp => set.has(cp))) { // must match all
				throw new Error(`restricted script cannot mix`);
			}
			if (cps.every(cp => RESTRICTED_WHOLES.has(cp))) {
				throw new Error(`restricted whole-script confusable`);
			}
			return true;
		}
	}
}

// requires decomposed codepoints
function check_combinining_marks(cps) {
	for (let i = 1, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			let prev = cps[i - 1];
			if (prev == FE0F) {
				throw new Error(`emoji + combining mark: ${str_from_cps(cps.slice(i-1, i+1))}`);
			}
			let seqs = CM_WHITELIST.get(prev);
			if (seqs) {
				let k = i + 1;
				while (k < cps.length && CM.has(cps[k])) k++;
				let cms = cps.slice(i, k);
				let match = seqs.find(seq => !compare_arrays(seq, cms));
				if (!match) {
					throw new Error(`disallowed combining mark sequence: "${str_from_cps(cps.slice(i-1, k))}"`)
				}
				i = k; 
			} else if (i == j) { 
				// this needs to come after whitelist test since it can permit 2+
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i-2, i+1))}"`);
			} else {
				j = i + 1;
			}
		}
	}
}

function is_printable_mark(cp) {
	return CM.has(cp) || CM_INVALID.has(cp);
}

function should_escape(cp) {
	return ESCAPE.has(cp);
}

function ens_normalize_fragment(frag, nf = nfc) {
	return frag.split(STOP_CH).map(label => str_from_cps(nf(process(explode_cp(label))))).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(ens_split(name));
}

function ens_beautify(name) {
	return flatten(ens_split(name, x => x));
}

function ens_split(name, emoji_filter = filter_fe0f) {
	let offset = 0;
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint not string!
		};
		offset += input.length + 1;
		try {
			let mapped = info.mapped = process(input);
			let norm = info.output = nfc(mapped.flatMap(x => Array.isArray(x) ? emoji_filter(x) : x)); // strip FE0F from emoji
			info.emoji = mapped.some(x => Array.isArray(x)); // mapped.reduce((a, x) => a + (Array.isArray(x)?1:0), 0);
			check_leading_underscore(norm); // should restricted get underscores? (20221018: no)
			if (CM.has(norm[0])) throw new Error(`leading combining mark`);
			check_label_extension(norm);
			let decomp = nfd(mapped.map(x => Array.isArray(x) ? FE0F : x)); // replace emoji with single character placeholder
			if (check_restricted_scripts(decomp)) {
				info.script = mapped.every(x => Array.isArray(x)) ? COMMON : 'Restricted';
			} else {
				check_combinining_marks(decomp);			
				check_surrounding(norm, 0x2019, 'apostrophe', true, true); // question: can this be generalized better?
				//check_middle_dot(norm);
				info.script = check_scripts(nfc(mapped.flatMap(x => Array.isArray(x) ? [] : x))); // remove emoji
			}
		} catch (err) {
			info.error = err.message;
		}
		return info;
	});
}

// throw on first error
function flatten(split) {
	return split.map(({input, error, output}) => {
		if (error) throw new Error(split.length == 1 ? error : `Invalid label "${safe_str_from_cps(input)}": ${error}`);
		return str_from_cps(output);
	}).join(STOP_CH);
}

function process(input) {
	let ret = []; 
	input = input.slice().reverse(); // flip so we can pop
	while (input.length) {
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			ret.push(emoji);
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				ret.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					ret.push(...cps);
				} else if (!IGNORED.has(cp)) {
					let form = should_escape(cp) ? '' : ` "${safe_str_from_cps([cp])}"`;
					throw new Error(`disallowed character:${form} ${quote_cp(cp)}`); 
				}
			}
		}
	}
	return ret;
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
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

// return all supported emoji
function ens_emoji() {
	let ret = [...EMOJI_SOLO].map(x => [x]);
	build(EMOJI_ROOT, []);
	return ret.sort(compare_arrays);
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
			if (cp === STOP) {
				tokens.push({type: TY_STOP, cp});
			} else if (VALID.has(cp)) {
				/*
				if (CM_WHITELIST.get(cp) === CM_ISOLATED_PH) {
					tokens.push({type: TY_ISOLATED, cp});
				} else {
					tokens.push({type: TY_VALID, cps: [cp]});
				}
				*/
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
			} else if (token.type === TY_EMOJI) {
				start = -1; // reset
			}
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

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, is_printable_mark, nfc, nfd, safe_str_from_cps, should_escape };
