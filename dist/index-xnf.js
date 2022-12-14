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

// created 2022-12-14T08:11:47.503Z
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
		// 20221213: fixes bidi subdomain issue, but breaks invariant (200E is disallowed)
		// could be fixed with special case for: 2D (.) + 200E (LTR)
		// output.splice(0, 0, 0x200E);
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
