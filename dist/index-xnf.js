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

// created 2022-12-05T00:28:25.581Z
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
