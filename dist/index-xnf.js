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

// created 2022-11-28T06:03:38.144Z
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
