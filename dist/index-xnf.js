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

// created 2022-11-25T10:06:21.420Z
var r = read_compressed_payload('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');
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

const STOP = 0x2E;
const FE0F = 0xFE0F;
const STOP_CH = '.';
const UNIQUE_PH = 1;

function read_set() {
	return new Set(read_sorted(r));
}
const MAPPED = new Map(read_mapped(r)); 
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
const CHUNKS = read_sorted_arrays(r);
function read_chunked() {
	return new Set([read_sorted(r).map(i => CHUNKS[i]), read_sorted(r)].flat(2));
}
const UNRESTRICTED = r();
const GROUPS = read_array_while(I => {
	let N = read_array_while(r).map(x => x+0x60);
	if (N.length) {
		let R = I >= UNRESTRICTED; // first arent restricted
		N[0] -= 32; // capitalize
		N = str_from_cps(N);
		if (R) N=`Restricted[${N}]`;
		let P = read_chunked(); // primary
		let Q = read_chunked(); // secondary
		let V = [...P, ...Q].sort((a, b) => a-b); // derive: sorted valid
		let M = r()-1; // combining mark
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
		return {I, N, P, M, R, V: new Set(V)};
	}
});

const WHOLE_VALID = read_set();
const WHOLE_MAP = new Map();
[...WHOLE_VALID, ...read_set()].sort((a, b) => a-b).map((cp, i, v) => {
	let d = r(); 
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
let valid_union = [...new Set(GROUPS.flatMap(g => [...g.V]))];
for (let cp of valid_union) {
	if (!WHOLE_MAP.has(cp) && GROUPS.filter(g => g.V.has(cp)).length == 1) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}

const VALID = new Set([...valid_union, ...nfd(valid_union)]);

const EMOJI_SORTED = read_sorted(r);
//const EMOJI_SOLO = new Set(read_sorted(r).map(i => EMOJI_SORTED[i]));
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
						check_leading_combining_mark(norm);
						check_fenced(norm);
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								throw new Error(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`);
							}
						}
						let unique_cps = [...new Set(chars)];
						let [g] = determine_group(unique_cps, chars);
						check_group(g, chars);
						check_whole(g, unique_cps);
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

function error_group_member(g, cp) {
	let quoted = quoted_cp(cp);
	let gg = GROUPS.find(g => g.P.has(cp));
	if (gg) {
		quoted = `${gg.N} ${quoted}`;
	}
	return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}

function error_disallowed(cp) {
	return new Error(`disallowed character: ${quoted_cp(cp)}`); 
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

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, is_combining_mark, nfc, nfd, safe_str_from_cps, should_escape };
