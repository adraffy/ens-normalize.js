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

// created 2022-12-04T03:43:39.000Z
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

//const t0 = performance.now();

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
const GROUPS = read_array_while(i => {
	let N = read_array_while(r).map(x => x+0x60);
	if (N.length) {
		let R = i >= UNRESTRICTED; // first arent restricted
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
		return {N, P, M, R, V: new Set(V)};
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

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, is_combining_mark, nfc, nfd, safe_str_from_cps, should_escape };
