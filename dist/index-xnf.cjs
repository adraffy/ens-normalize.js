'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

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

// created 2023-02-20T06:40:21.572Z
var r = read_compressed_payload('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');
const FENCED = new Map([[8217,"apostrophe"],[8260,"fraction slash"],[12539,"middle dot"]]);
const NSM_MAX = 4;

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
	let n = a.length;
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
const HYPHEN = 0x2D;

function read_set() {
	return new Set(read_sorted(r));
}
const MAPPED = new Map(read_mapped(r)); 
const IGNORED = read_set(); // ignored characters are not valid, so just read raw codepoints
/*
// direct include from payload is smaller that the decompression code
const FENCED = new Map(read_array_while(() => {
	let cp = r();
	if (cp) return [cp, read_str(r())];
}));
*/
// 20230217: we still need all CM for proper error formatting
// but norm only needs NSM subset that are potentially-valid
const CM = read_set();
const NSM = new Set(read_sorted(r).map(function(i) { return this[i]; }, [...CM]));
/*
const CM_SORTED = read_sorted(r);
const NSM = new Set(read_sorted(r).map(i => CM_SORTED[i]));
const CM = new Set(CM_SORTED);
*/
const ESCAPE = read_set(); // characters that should not be printed
const NFC_CHECK = read_set();
const CHUNKS = read_sorted_arrays(r);
function read_chunked() {
	// deduplicated sets + uniques
	return new Set([read_sorted(r).map(i => CHUNKS[i]), read_sorted(r)].flat(2));
}
const UNRESTRICTED = r();
const GROUPS = read_array_while(i => {
	// minifier property mangling seems unsafe
	// so these are manually renamed to single chars
	let N = read_array_while(r).map(x => x+0x60);
	if (N.length) {
		let R = i >= UNRESTRICTED; // first arent restricted
		N[0] -= 32; // capitalize
		N = str_from_cps(N);
		if (R) N=`Restricted[${N}]`;
		let P = read_chunked(); // primary
		let Q = read_chunked(); // secondary
		let V = [...P, ...Q].sort((a, b) => a-b); // derive: sorted valid
		//let M = r()-1; // combining mark
		let M = !r(); // not-whitelisted, check for NSM
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
// decode compressed wholes
[...WHOLE_VALID, ...read_set()].sort((a, b) => a-b).map((cp, i, v) => {
	let d = r(); 
	let w = v[i] = d ? v[i-d] : {V: [], M: new Map()};
	w.V.push(cp); // add to member set
	if (!WHOLE_VALID.has(cp)) {
		WHOLE_MAP.set(cp, w);  // register with whole map
	}
});
// compute confusable-extent complements
for (let {V, M} of new Set(WHOLE_MAP.values())) {
	// connect all groups that have each whole character
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
	// per character cache groups which are not a member of the extent
	let union = recs.flatMap(({G}) => [...G]);
	for (let {G, V} of recs) {
		let complement = new Set(union.filter(g => !G.has(g)));
		for (let cp of V) {
			M.set(cp, complement);
		}
	}
}
let union = new Set(); // exists in 1+ groups
let multi = new Set(); // exists in 2+ groups
for (let g of GROUPS) {
	for (let cp of g.V) {
		(union.has(cp) ? multi : union).add(cp);
	}
}
// dual purpose WHOLE_MAP: return placeholder if unique non-confusable
for (let cp of union) {
	if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}
const VALID = new Set([...union, ...nfd(union)]); // possibly valid

// decode emoji
const EMOJI_SORTED = read_sorted(r); // temporary
//const EMOJI_SOLO = new Set(read_sorted(r).map(i => EMOJI_SORTED[i])); // not needed
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
// quoter(cp) => string, eg. 3000 => "{3000}"
// note: in html, you'd call this function then replace [<>&] with entities
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
	return (should_escape(cp) ? '' : `${bidi_qq(safe_str_from_cps([cp]))} `) + quote_cp(cp);
}

// 20230211: some messages can be mixed-directional and result in spillover
// use 200E after a quoted string to force the remainder of a string from 
// acquring the direction of the quote
// https://www.w3.org/International/questions/qa-bidi-unicode-controls#exceptions
function bidi_qq(s) {
	return `"${s}"\u200E`; // strong LTR
}

function check_label_extension(cps) {
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
	let last = -1; // prevents trailing from throwing
	for (let i = 1; i < n; i++) {
		cp = cps[i];
		let match = FENCED.get(cp);
		if (match) {
			// since cps[0] isn't fenced, cps[1] cannot throw
			if (last == i) throw error_placement(`${prev} + ${match}`);
			last = i + 1;
			prev = match;
		}
	}
	if (last == n) throw error_placement(`trailing ${prev}`);
}

// note: set(s) cannot be exposed because they can be modified
function is_combining_mark(cp) {
	return CM.has(cp);
}
function should_escape(cp) {
	return ESCAPE.has(cp);
}

function ens_normalize_fragment(frag, decompose) {
	let nf = decompose ? nfd : nfc;
	return frag.split(STOP_CH).map(label => str_from_cps(process(explode_cp(label), nf).flatMap(x => x.is_emoji ? filter_fe0f(x) : x))).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(ens_split(name));
}

function ens_beautify(name) {
	let split = ens_split(name, true);
	// this is experimental
	for (let {type, output, error} of split) {
		if (error) continue;

		// replace leading/trailing hyphen
		// 20230121: consider beautifing all or leading/trailing hyphen to unicode variant
		// not exactly the same in every font, but very similar: "-" vs "‐"
		/*
		const UNICODE_HYPHEN = 0x2010;
		// maybe this should replace all for visual consistancy?
		// `node tools/reg-count.js regex ^-\{2,\}` => 592
		//for (let i = 0; i < output.length; i++) if (output[i] == 0x2D) output[i] = 0x2010;
		if (output[0] == HYPHEN) output[0] = UNICODE_HYPHEN;
		let end = output.length-1;
		if (output[end] == HYPHEN) output[end] = UNICODE_HYPHEN;
		*/
		// 20230123: WHATWG URL uses "CheckHyphens" false
		// https://url.spec.whatwg.org/#idna

		// update ethereum symbol
		// ξ => Ξ if not greek
		if (type !== 'Greek') { 
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
		//output.splice(0, 0, 0x200E);
	}
	return flatten(split);
}

function ens_split(name, preserve_emoji) {
	let offset = 0;
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// 4.) "The label must not contain a U+002E ( . ) FULL STOP."
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint, not substring!
		};
		offset += input.length + 1; // + stop
		let norm;
		try {
			// 1.) "The label must be in Unicode Normalization Form NFC"
			let tokens = info.tokens = process(input, nfc); // if we parse, we get [norm and mapped]
			let token_count = tokens.length;
			let type;
			if (!token_count) { // the label was effectively empty (could of had ignored characters)
				// 20230120: change to strict
				// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/59
				//norm = [];
				//type = 'None'; // use this instead of next match, "ASCII"
				throw new Error(`empty label`);
			} else {
				let chars = tokens[0];
				let emoji = token_count > 1 || chars.is_emoji;
				if (!emoji && chars.every(cp => cp < 0x80)) { // special case for ascii
					norm = chars;
					check_leading_underscore(norm);
					// only needed for ascii
					// 20230123: matches matches WHATWG, see note 3.3
					check_label_extension(norm);
					// cant have fenced
					// cant have cm
					// cant have wholes
					// see derive: "Fastpath ASCII"
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
						// 5. "The label must not begin with a combining mark, that is: General_Category=Mark."
						if (CM.has(norm[0])) throw error_placement('leading combining mark');
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								// bidi_qq() not needed since emoji is LTR and cps is a CM
								throw error_placement(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`); 
							}
						}
						check_fenced(norm);
						let unique = [...new Set(chars)];
						let [g] = determine_group(unique); // take the first match
						// see derive: "Matching Groups have Same CM Style"
						// alternative: could form a hybrid type: Latin/Japanese/...	
						check_group(g, chars); // need text in order
						check_whole(g, unique); // only need unique text (order would be required for multiple-char confusables)
						type = g.N;
						// 20230121: consider exposing restricted flag
						// it's simpler to just check for 'Restricted'
						// or even better: type.endsWith(']')
						//if (g.R) info.restricted = true;
					}
				}
			}
			info.type = type;
		} catch (err) {
			info.error = err; // use full error object
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
			// bidi_qq() only necessary if msg is digits
			throw new Error(split.length == 1 ? msg : `Invalid label ${bidi_qq(safe_str_from_cps(input))}: ${msg}`); 
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
// assumption: the previous character isn't an emoji
function check_group(g, cps) {
	let {V, M} = g;
	for (let cp of cps) {
		if (!V.has(cp)) {
			// for whitelisted scripts, this will throw illegal mixture on invalid cm, eg. "e{300}{300}"
			// at the moment, it's unnecessary to introduce an extra error type
			// until there exists a whitelisted multi-character
			//   eg. if (M < 0 && is_combining_mark(cp)) { ... }
			// there are 3 cases:
			//   1. illegal cm for wrong group => mixture error
			//   2. illegal cm for same group => cm error
			//       requires set of whitelist cm per group: 
			//        eg. new Set([...g.V].flatMap(nfc).filter(cp => CM.has(cp)))
			//   3. wrong group => mixture error
			throw error_group_member(g, cp);
		}
	}
	//if (M >= 0) { // we have a known fixed cm count
	if (M) { // we need to check for NSM
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // see: assumption
			// 20230210: bugfix: using cps instead of decomposed h/t Carbon225
			/*
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: ${g.N} ${bidi_qq(str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${M})`);
				}
				i = j;
			}
			*/
			// 20230217: switch to NSM counting
			// https://www.unicode.org/reports/tr39/#Optional_Detection
			if (NSM.has(decomposed[i])) {
				let j = i + 1;
				for (let cp; j < e && NSM.has(cp = decomposed[j]); j++) {
					// a. Forbid sequences of the same nonspacing mark.
					for (let k = i; k < j; k++) { // O(n^2) but n < 100
						if (decomposed[k] == cp) {
							throw new Error(`non-spacing marks: repeated ${quoted_cp(cp)}`);
						}
					}
				}
				// parse to end so we have full nsm count
				// b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
				if (j - i > NSM_MAX) {
					// note: this slice starts with a base char or spacing-mark cm
					throw new Error(`non-spacing marks: too many ${bidi_qq(safe_str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${NSM_MAX})`);
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
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: "${str_from_cps(decomposed.slice(i-1, j))}" (${j-i}/${M})`);
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

exports.ens_beautify = ens_beautify;
exports.ens_emoji = ens_emoji;
exports.ens_normalize = ens_normalize;
exports.ens_normalize_fragment = ens_normalize_fragment;
exports.ens_split = ens_split;
exports.ens_tokenize = ens_tokenize;
exports.is_combining_mark = is_combining_mark;
exports.nfc = nfc;
exports.nfd = nfd;
exports.safe_str_from_cps = safe_str_from_cps;
exports.should_escape = should_escape;
