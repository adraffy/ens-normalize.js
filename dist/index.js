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

// created 2022-10-25T03:50:23.437Z
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

// created 2022-10-25T03:50:23.504Z
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
			let bad = cps.find(cp => !rest.some(set => set.has(cp)) && !extra.has(cp)); // should just show first char
			if (bad >= 0) {
				throw new Error(`mixed-script ${name} confusable: "${str_from_cps([bad])}"`);
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
		// don't print label again if just a single label
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
