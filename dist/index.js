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

// created 2022-10-30T00:28:32.139Z
var r$1 = read_compressed_payload('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');
const ORDERED_SCRIPTS = [{"name":"Korean","test":[1],"rest":[0,2],"allow":[97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122],"deny":[]},{"name":"Japanese","test":[3,4],"rest":[0,2],"allow":[97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122],"deny":[]},{"name":"Han","test":[2],"rest":[0],"allow":[97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122],"deny":[]},{"name":"Latin","test":[5],"rest":[0],"allow":[],"deny":[]},{"name":"Cyrillic","test":[6],"rest":[0],"allow":[],"deny":[]},{"name":"Greek","test":[7],"rest":[0],"allow":[],"deny":[]},{"name":"Arabic","test":[8],"rest":[],"allow":[45],"deny":[]},{"name":"Devanagari","test":[9],"rest":[],"allow":[],"deny":[]},{"name":"Hebrew","test":[10],"rest":[],"allow":[8362],"deny":[]},{"name":"Thai","test":[11],"rest":[],"allow":[3647],"deny":[]}];

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

// created 2022-10-30T00:28:32.217Z
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
	return {name, test, rest, allow: read_valid_subset(), deny: read_valid_subset(), wholes: read_valid_subset()};
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

// create a safe to print string 
// invisibles are escaped
// leading cm use placeholder
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
	for (let {name, test, rest, allow, deny, wholes} of ORDERED) {
		if (cps.some(cp => test.some(set => set.has(cp)))) {
			for (let cp of cps) {
				// https://www.unicode.org/reports/tr39/#mixed_script_confusables
				if (!rest.some(set => set.has(cp)) && !allow.has(cp)) {
					throw new Error(`mixed-script ${name} confusable: "${safe_str_from_cps([cp])}"`);
				}
				// https://www.unicode.org/reports/tr39/#single_script_confusables
				if (deny.has(cp)) {
					throw new Error(`single-script ${name} confusable: "${safe_str_from_cps([cp])}"`);
				}
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


function check_leading_combining_mark(cps) {
	if (CM.has(cps[0])) throw new Error(`leading combining mark`);
}
// requires decomposed codepoints
function check_combining_marks(cps) {
	for (let i = 1, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			let prev = cps[i - 1];
			if (prev == FE0F) {
				throw new Error(`emoji + combining mark`); // we dont know the full emoji length efficiently 
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
	let split = ens_split(name, x => x);
	for (let {script, output} of split) {
		if (script !== 'Greek') {
			let prev = 0;
			while (true) {
				let next = output.indexOf(0x3BE, prev);
				if (next < 0) break;
				output[next] = 0x39E; // ξ => Ξ if not greek
				prev = next + 1;
			}
		}
	}
	return flatten(split);
}

function ens_split(name, emoji_filter = filter_fe0f) {
	let offset = 0;
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint, not string!
		};
		offset += input.length + 1;
		try {
			let mapped = info.mapped = process(input);
			let norm = info.output = nfc(mapped.flatMap(x => Array.isArray(x) ? emoji_filter(x) : x)); // strip FE0F from emoji
			info.emoji = mapped.some(x => Array.isArray(x)); // idea: count emoji? mapped.reduce((a, x) => a + (Array.isArray(x)?1:0), 0);
			check_leading_underscore(norm); // should restricted get underscores? (20221018: no)
			check_leading_combining_mark(norm);
			check_label_extension(norm);
			let decomp = nfd(mapped.map(x => Array.isArray(x) ? FE0F : x)); // replace emoji with single character placeholder
			if (check_restricted_scripts(decomp)) {
				info.script = mapped.every(x => Array.isArray(x)) ? COMMON : 'Restricted'; // name might be all emoji
			} else {
				check_combining_marks(decomp);
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
			} else if (token.type === TY_EMOJI) { // 20221024: is this correct?
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
