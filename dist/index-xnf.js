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

// created 2022-12-03T08:12:05.523Z
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
