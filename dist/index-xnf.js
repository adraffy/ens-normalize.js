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

// created 2022-11-18T05:01:04.481Z
var r = read_compressed_payload('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');

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

// reverse polyfill

function nf(cps, form) {
	return explode_cp(str_from_cps(cps).normalize(form));
}

function nfc(cps) {
	return nf(cps, 'NFC');
}
function nfd(cps) {
	return nf(cps, 'NFD');
}

function read_set() {
	return new Set(read_sorted(r));
}
function read_str(n) {
	return str_from_cps(read_deltas(n, r));
}

const MAPPED = new Map(read_mapped(r)); 
const IGNORED = read_set(); // ignored characters are not valid, so just read raw codepoints
const FENCED = new Map(read_array_while(() => {
	let cp = r();
	if (cp) return [cp, read_str(r())];
}));
const CM = read_set();
const ESCAPE = read_set(); // characters that should not be printed
const NFC_CHECK = read_set();
const CHUNKS = read_sorted_arrays(r);
function read_chunked() {
	return new Set([read_sorted(r).map(i => CHUNKS[i]), read_sorted(r)].flat(2));
}
const GROUPS = read_array_while(() => {
	let N = r();
	if (N) {
		let R = N==1;
		N = R ? 'Restricted' : read_str(N-1);
		let P = read_chunked(); // primary
		let Q = read_chunked(); // secondary
		let V = [...P, ...Q].sort((a, b) => a-b); // derive: sorted valid
		//let W = read_set(); // wholes
		let M = r()-1; // combining mark
		if (M < 0) { // whitelisted
			M = new Map(read_array_while(() => {
				let i = r();
				if (i) return [V[i-1], read_array_while(() => {
					let v = read_array_while(r);
					if (v.length) return v.map(x => x-1);
				})];
			}));
		}
		return {N, P, M, R, V: new Set(V)};
	}
});
const WHOLES = new Map(read_array_while(() => {
	let cps = read_sorted(r);
	if (cps.length) {
		let set = read_set();
		//let whole = {set, cps};
		// at the moment, we just need the set
		return cps.map(cp => [cp, set]);
	}
}).flat());
const EMOJI_SORTED = read_sorted(r);
const EMOJI_SOLO = new Set(read_sorted(r).map(i => EMOJI_SORTED[i]));
const EMOJI_ROOT = read_emoji_trie([]);
function read_emoji_trie(cps) {
	let B = read_array_while(() => {
		let keys = read_sorted(r).map(i => EMOJI_SORTED[i]);
		if (keys.length) return read_emoji_trie(keys);
	}).sort((a, b) => b.Q.size - a.Q.size); // sort by likelihood
	let temp = r();
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
								throw new Error(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`);
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
		// does any other group have all of these characters?
		// "0x" vs "0"+cyrl(x)
		// cover: [Latin, Cyrl]
		// free: ["0"]
		for (let i of cover) {
			let g = GROUPS[i];
			//if (free.every(cp => g.V.has(cp)) && !confused.every(cps => cps.some(cp => g.V.has(cp)))) {
			if (free.every(cp => g.V.has(cp)) && !confused.every(cp => g.V.has(cp))) {
				throw new Error(`whole-label confusable`);
			}
		}
	}
	// is the cover a hint?
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
	let {V, M} = g;
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
