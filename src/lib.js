import COMPRESSED, {FENCED, NSM_MAX} from './include-ens.js';
import {read_compressed_payload, read_set, read_sorted, read_sorted_arrays, read_mapped, read_trie, read_array_while} from './decoder.js';
import {explode_cp, str_from_cps, quote_cp, compare_arrays} from './utils.js';
import {nfc, nfd} from './nf.js';
//import {nfc, nfd} from './nf-native.js'; // replaced by rollup
export {nfc, nfd}; 

const STOP = 0x2E;
const FE0F = 0xFE0F;
const STOP_CH = '.';
const UNIQUE_PH = 1;
const HYPHEN = 0x2D;

class Emoji extends Array {
	get is_emoji() { return true; } // free tagging system
}

let MAPPED, IGNORED, CM, NSM, ESCAPE, NFC_CHECK, GROUPS, WHOLE_VALID, WHOLE_MAP, VALID, EMOJI_LIST, EMOJI_ROOT;

function init() {
	if (MAPPED) return;
	//console.time('lib');

	let r = read_compressed_payload(COMPRESSED);
	MAPPED = new Map(read_mapped(r)); 
	IGNORED = read_set(r); // ignored characters are not valid, so just read raw codepoints

	/*
	// direct include from payload is smaller than the decompression code
	const FENCED = new Map(read_array_while(() => {
		let cp = r();
		if (cp) return [cp, read_str(r())];
	}));
	*/
	// 20230217: we still need all CM for proper error formatting
	// but norm only needs NSM subset that are potentially-valid
	CM = read_sorted(r);
	NSM = new Set(read_sorted(r).map(i => CM[i]));
	CM = new Set(CM);
	
	ESCAPE = read_set(r); // characters that should not be printed
	NFC_CHECK = read_set(r); // only needed to illustrate ens_tokenize() transformations

	let chunks = read_sorted_arrays(r);
	function read_chunked() {
		// deduplicated sets + uniques
		return new Set([read_sorted(r).map(i => chunks[i]), read_sorted(r)].flat(2));
	}
	let unrestricted = r();
	GROUPS = read_array_while(i => {
		// minifier property mangling seems unsafe
		// so these are manually renamed to single chars
		let N = read_array_while(r).map(x => x+0x60);
		if (N.length) {
			let R = i >= unrestricted; // first arent restricted
			N[0] -= 32; // capitalize
			N = str_from_cps(N);
			if (R) N=`Restricted[${N}]`;
			let P = read_chunked(r); // primary
			let Q = read_chunked(r); // secondary
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

	// decode compressed wholes
	WHOLE_VALID = read_set(r);
	WHOLE_MAP = new Map();
	let wholes = [...WHOLE_VALID, ...read_sorted(r)].sort((a, b) => a-b);
	wholes.forEach((cp, i) => {
		let d = r(); 
		let w = wholes[i] = d ? wholes[i-d] : {V: [], M: new Map()};
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
			if (union.has(cp)) {
				multi.add(cp);
			} else {
				union.add(cp);
			}
		}
	}
	// dual purpose WHOLE_MAP: return placeholder if unique non-confusable
	for (let cp of union) {
		if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
			WHOLE_MAP.set(cp, UNIQUE_PH);
		}
	}

	VALID = new Set([...union, ...nfd(union)]); // possibly valid

	// decode emoji
	// 20230719: emoji are now fully-expanded to avoid quirk logic 
	EMOJI_LIST = read_trie(r).map(v => Emoji.from(v)).sort(compare_arrays);
	EMOJI_ROOT = new Map(); // this has approx 7K nodes (2+ per emoji)
	for (let cps of EMOJI_LIST) {
		// 20230719: change to *slightly* stricter algorithm which disallows 
		// insertion of misplaced FE0F in emoji sequences (matching ENSIP-15)
		// example: beautified [A B] (eg. flag emoji) 
		//  before: allow: [A FE0F B], error: [A FE0F FE0F B] 
		//   after: error: both
		// note: this code now matches ENSNormalize.{cs,java} logic
		let prev = [EMOJI_ROOT];
		for (let cp of cps) {
			let next = prev.map(node => {
				let child = node.get(cp);
				if (!child) {
					// should this be object? 
					// (most have 1-2 items, few have many)
					// 20230719: no, v8 default map is 4?
					child = new Map();
					node.set(cp, child);
				}
				return child;
			});
			if (cp === FE0F) {
				prev.push(...next);
			} else {
				prev = next;
			}
		}
		for (let x of prev) {
			x.V = cps;
		}
	}

	//console.timeEnd('lib');
	// 20230905: 285ms
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
		throw new Error(`invalid label extension: "${str_from_cps(cps.slice(0, 4))}"`);
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

// create a safe to print string 
// invisibles are escaped
// leading cm uses placeholder
// quoter(cp) => string, eg. 3000 => "{3000}"
// note: in html, you'd call this function then replace [<>&] with entities
export function safe_str_from_cps(cps, quoter = quote_cp) {
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

// note: set(s) cannot be exposed because they can be modified
export function is_combining_mark(cp) {
	init();
	return CM.has(cp);
}
export function should_escape(cp) {
	init();
	return ESCAPE.has(cp);
}

// return all supported emoji as fully-qualified emoji 
// ordered by length then lexicographic 
export function ens_emoji() {
	init();
	return EMOJI_LIST.map(x => x.slice()); // emoji are exposed so copy
}

export function ens_normalize_fragment(frag, decompose) {
	init();
	let nf = decompose ? nfd : nfc;
	return frag.split(STOP_CH).map(label => str_from_cps(tokens_from_str(explode_cp(label), nf, filter_fe0f).flat())).join(STOP_CH);
}

export function ens_normalize(name) {
	return flatten(split(name, nfc, filter_fe0f));
}

export function ens_beautify(name) {
	let labels = split(name, nfc, x => x); // emoji not exposed
	for (let {type, output, error} of labels) {
		if (error) break; // flatten will throw

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
	return flatten(labels);
}

export function ens_split(name, preserve_emoji) {
	return split(name, nfc, preserve_emoji ? x => x.slice() : filter_fe0f); // emoji are exposed so copy
}

function split(name, nf, ef) {
	if (!name) return []; // 20230719: empty name allowance
	init();
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
			let tokens = info.tokens = tokens_from_str(input, nf, ef); // if we parse, we get [norm and mapped]
			let token_count = tokens.length;
			let type;
			if (!token_count) { // the label was effectively empty (could of had ignored characters)
				// 20230120: change to strict
				// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/59
				//norm = [];
				//type = 'None'; // use this instead of next match, "ASCII"
				throw new Error(`empty label`);
			} else {
				norm = tokens.flat();
				check_leading_underscore(norm);
				let emoji = info.emoji = token_count > 1 || tokens[0].is_emoji;
				if (!emoji && norm.every(cp => cp < 0x80)) { // special case for ascii
					// only needed for ascii
					// 20230123: matches matches WHATWG, see note 3.3
					check_label_extension(norm);
					// cant have fenced
					// cant have cm
					// cant have wholes
					// see derive: "Fastpath ASCII"
					type = 'ASCII';
				} else {
					let chars = tokens.flatMap(x => x.is_emoji ? [] : x); // all of the nfc tokens concat together
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
		// check if any of the remaining groups
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
			if (!GROUPS.some(g => g.V.has(cp))) { 
				// the character was composed of valid parts
				// but it's NFC form is invalid
				// 20230716: change to more exact statement, see: ENSNormalize.{cs,java}
				// note: this doesn't have to be a composition
				// 20230720: change to full check
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
							throw new Error(`duplicate non-spacing marks: ${quoted_cp(cp)}`);
						}
					}
				}
				// parse to end so we have full nsm count
				// b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
				if (j - i > NSM_MAX) {
					// note: this slice starts with a base char or spacing-mark cm
					throw new Error(`excessive non-spacing marks: ${bidi_qq(safe_str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${NSM_MAX})`);
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
// 20230818: rename for 'process' name collision h/t Javarome
// https://github.com/adraffy/ens-normalize.js/issues/23
function tokens_from_str(input, nf, ef) {
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
			ret.push(ef(emoji));
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				chars.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					chars.push(...cps);
				} else if (!IGNORED.has(cp)) {
					// 20230912: unicode 15.1 changed the order of processing such that
					// disallowed parts are only rejected after NFC
					// https://unicode.org/reports/tr46/#Validity_Criteria
					// this doesn't impact normalization as of today
					// technically, this error can be removed as the group logic will apply similar logic
					// however the error type might be less clear
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
// disallows interleaved ignored characters
// fills (optional) eaten array with matched codepoints
function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let pos = cps.length;
	while (pos) {
		node = node.get(cps[--pos]);
		if (!node) break;
		let {V} = node;
		if (V) { // this is a valid emoji (so far)
			emoji = V;
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	return emoji;
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

export function ens_tokenize(name, {
	nf = true, // collapse unnormalized runs into a single token
} = {}) {
	init();
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({
				type: TY_EMOJI, 
				emoji: emoji.slice(), // copy emoji
				input: eaten, 
				cps: filter_fe0f(emoji)
			});
			eaten = []; // reset buffer
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
