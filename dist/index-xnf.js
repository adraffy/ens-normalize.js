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

// created 2022-12-11T09:53:55.088Z
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
							input: cps0, // there are 3 states: tokens0 ==(process)=> input ==(nfc)=> tokens/cps
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
