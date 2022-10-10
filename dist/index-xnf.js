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

function read_counts(n, next) {
	let v = Array(n);
	for (let i = 0; i < n; i++) v[i] = 1 + next();
	return v;
}

function read_ascending(n, next) {
	let v = Array(n);
	for (let i = 0, x = -1; i < n; i++) v[i] = x += 1 + next();
	return v;
}

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// return unsorted? unique array 
function read_member_array(next, lookup) {
	let v = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < vN[i]; j++) {
			v.push(vX[i] + j);
		}
	}
	return lookup ? v.map(x => lookup[x]) : v;
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

function read_emoji_trie(next) {
	let sorted = read_member_array(next).sort((a, b) => a - b);
	return read();
	function read() {
		let branches = [];
		while (true) {
			let keys = read_member_array(next, sorted);
			if (keys.length == 0) break;
			branches.push({set: new Set(keys), node: read()});
		}
		branches.sort((a, b) => b.set.size - a.set.size); // sort by likelihood
		let temp = next();
		let valid = temp % 3;
		temp = (temp / 3)|0;
		let fe0f = !!(temp & 1);
		temp >>= 1;
		let save = temp == 1;
		let check = temp == 2;
		return {branches, valid, fe0f, save, check};
	}
}

// created 2022-10-10T20:25:23.883Z
var r = read_compressed_payload('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');

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
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
	return String.fromCodePoint(...cps);
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

const SORTED_VALID = read_member_array(r).sort((a, b) => a - b);
const VALID = new Set(SORTED_VALID);
const IGNORED = new Set(read_member_array(r));
const MAPPED = new Map(read_mapped(r));
function read_valid_subset() {
	return new Set(read_member_array(r, SORTED_VALID));
}
const CM = read_valid_subset();
const ISOLATED = read_valid_subset();
const SCRIPTS = ['Latin', 'Greek', 'Cyrillic'].map((k, i) => {
	// this defines the priority
	// order must match make.js
	// note: there are no latin (index = 0) whole-script confusables
	// (script name, script-set, whole-set?)
	return [k, read_valid_subset(), i ? read_valid_subset() : 0]; 
});
const RESTRICTED = read_array_while(() => {
	let v = read_valid_subset();
	if (v.size) return v;
});
const EMOJI_SOLO = new Set(read_member_array(r));
const EMOJI_ROOT = read_emoji_trie(r);
const NFC_CHECK = read_valid_subset();

const STOP = 0x2E;
const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const FE0F = 0xFE0F;

function check_leading_underscore(cps) {
	let i = cps.lastIndexOf(UNDERSCORE);
	while (i > 0) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error(`underscore only allowed at start`);
		}
	}
}

function check_label_extension(cps) {
	if (cps.length >= 4 && cps[2] === HYPHEN && cps[3] === HYPHEN && cps.every(cp => cp < 0x80)) {
		throw new Error(`invalid label extension`);
	}
}

// check that cp is not touching another cp
// optionally disallow leading/trailing
function check_surrounding(cps, cp, name, no_leading, no_trailing) {
	let last = -1;
	if (cps[0] === cp) {
		if (no_leading) throw new Error(`leading ${name}`);
		last = 0;
	}
	while (true) {
		let i = cps.indexOf(cp, last+1);
		if (i == -1) break;
		if (last == i-1) throw new Error(`adjacent ${name}`);
		last = i;
	}
	if (no_trailing && last == cps.length-1) throw new Error(`trailing ${name}`);
}

// ContextO: MIDDLE DOT
// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
// Between 'l' (U+006C) characters only, used to permit the Catalan character ela geminada to be expressed.
function check_middle_dot(cps) {
	let i = 0;
	while (true) {
		i = cps.indexOf(0xB7, i);
		if (i == -1) break;
		if (cps[i-1] !== 0x6C || cps[i+1] !== 0x6C) throw new Error('ContextO: middle dot');
		i += 2;
	}
}

function check_scripts_latin_like(cps) {
	// https://www.unicode.org/reports/tr39/#mixed_script_confusables
	for (let i = 0; i < SCRIPTS.length; i++) {
		let [name, script_set, whole_set] = SCRIPTS[i];
		if (cps.some(cp => script_set.has(cp))) {
			for (let j = i + 1; j < SCRIPTS.length; j++) { // scripts before already had no match
				let [name_j, set_j] = SCRIPTS[j];
				if (cps.some(cp => set_j.has(cp))) {
					throw new Error(`mixed-script confusable: ${name} + ${name_j}`);
				}
			}
			if (whole_set) { // aka non-latin
				// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
				// if every char matching the script is confusable
				if (cps.every(cp => !script_set.has(cp) || whole_set.has(cp))) {
					throw new Error(`whole-script confusable: ${name}`);
				}
			}
			break;
		}
	}
}

// requires decomposed codepoints
function check_restricted_scripts(cps) {
	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	for (let set of RESTRICTED) {
		if (cps.some(cp => set.has(cp))) { // first with one match
			if (!cps.every(cp => set.has(cp) || cp == FE0F)) { // must match all (or emoji)
				throw new Error(`restricted script cannot mix`);
			}
			break; // pure
		}
	}
}

// requires decomposed codepoints
function check_combinining_marks(cps) {
	for (let i = 0, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			if (i == 0) {
				throw new Error(`leading combining mark`);
			} else if (i == j) {
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i - 2, i + 1))}"`);
			} else {
				let prev = cps[i - 1];
				if (prev == FE0F || ISOLATED.has(prev)) {
					throw new Error(`isolate combining mark`);
				}
			}	
			j = i + 1;
		}
	}
}

// this function only makes sense if the input 
// was an output of ens_normalize_fragment 
function ens_normalize_post_check(norm) {
	for (let label of norm.split('.')) {
		if (!label) throw new Error('Empty label');
		try {
			let cps_nfc = explode_cp(label);
			check_leading_underscore(cps_nfc);
			check_label_extension(cps_nfc);
			check_surrounding(cps_nfc, 0x2019, 'apostrophe', true, true); // question: can this be generalized better?
			check_middle_dot(cps_nfc); // this a lot of effort for 1 character
			check_scripts_latin_like(cps_nfc);
			// replace emoji with single character
			let cps_nfd = nfd(process(label, () => [FE0F])); 
			check_combinining_marks(cps_nfd);
			check_restricted_scripts(cps_nfd); // idea: it's probably safe to early terminate if this is pure
		} catch (err) {
			throw new Error(`Invalid label "${label}": ${err.message}`); // note: label might not exist in the input string
		}
	}
	return norm;
}

function ens_normalize_fragment(frag, nf = nfc) {
	return str_from_cps(nf(process(frag, filter_fe0f)));
}

function ens_normalize(name) {
	return ens_normalize_post_check(ens_normalize_fragment(name));
}

// note: does not post_check
function ens_beautify(name) {
	return str_from_cps(nfc(process(name, x => x)));
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
}

function process(name, emoji_filter) {
	let input = explode_cp(name).reverse(); // flip so we can pop
	let output = [];
	while (input.length) {
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			output.push(...emoji_filter(emoji)); // idea: emoji_filter(emoji, output.length); // provide position to callback
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				output.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					output.push(...cps);
				} else if (!IGNORED.has(cp)) {
					throw new Error(`Disallowed codepoint: 0x${hex_cp(cp)}`);
				}
			}
		}
	}
	return output;
}

function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let saved;
	let stack = [];
	let pos = cps.length;
	if (eaten) eaten.length = 0; // clear input buffer (if needed)
	while (pos) {
		let cp = cps[--pos];
		let br = node.branches.find(x => x.set.has(cp));
		if (!br) break;
		node = br.node;
		if (node.save) { // remember
			saved = cp;
		} else if (node.check) { // check exclusion
			if (cp === saved) break;
		}
		stack.push(cp);
		if (node.fe0f) {
			stack.push(FE0F);
			if (pos > 0 && cps[pos - 1] == FE0F) pos--; // consume optional FE0F
		}
		if (node.valid) { // this is a valid emoji (so far)
			emoji = conform_emoji_copy(stack, node);
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	if (!emoji) {
		let cp = cps[cps.length-1];
		if (EMOJI_SOLO.has(cp)) {
			if (eaten) eaten.push(cp);
			emoji = [cp];
			cps.pop();
		}
	}
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = cps.slice(); // copy stack
	if (node.valid == 2) copy.splice(1, 1); // delete FE0F at position 1 (see: make.js)
	return copy;
}

// return all supported emoji (not sorted)
function ens_emoji() {
	let ret = [...EMOJI_SOLO].map(x => [x]);
	build(EMOJI_ROOT, []);
	return ret;
	function build(node, cps, saved) {
		if (node.save) { // remember
			saved = cps[cps.length-1];
		} else if (node.check) { // check exclusion
			if (saved === cps[cps.length-1]) return;
		}
		if (node.fe0f) cps.push(FE0F);
		if (node.valid) ret.push(conform_emoji_copy(cps, node));
		for (let br of node.branches) {
			for (let cp of br.set) {
				build(br.node, [...cps, cp], saved);
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
const TY_ISOLATED = 'isolated';
const TY_NFC = 'nfc';
const TY_STOP = 'stop';

/*
class EmojiToken {
	constructor(input, emoji) {
		this.input = input;
		this.emoji = emoji;
	}
	get type() {
		return TY_EMOJI;
	}
	get cps() {
		return filter_fe0f(this.cps);
	}	
}
class SingleToken {
	constructor(type, cp) {
		this.type = type;
		this.cp = cp;
	}
	get input() { return [this.cp]; }
	get cps() { return this.input() }
}
class MappedToken extends SingleToken {
	constructor(cp, cps) {
		this.cp = cp;
		this.cps = cps;
	}
	get type() { return TY_MAPPED; }
	get input() { return [this.cp]; }
}
class NFCToken {
	constructor(tokens) {

	}
}
*/

function ens_tokenize(name) {
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({type: TY_EMOJI, emoji, input: eaten.slice(), cps: filter_fe0f(emoji)});
		} else {
			let cp = input.pop();
			if (cp === STOP) {
				tokens.push({type: TY_STOP, cp});
			} else if (VALID.has(cp)) {
				if (ISOLATED.has(cp)) {
					tokens.push({type: TY_ISOLATED, cp});
				} else {
					tokens.push({type: TY_VALID, cps: [cp]});
				}
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
				let cps = nfc(cps0); // this does extra work for nf-native but oh well
				//if (cps0.length === cps.length && cps0.every((cp, i) => cp === cps[i])) { 
				if (str_from_cps(cps0) === str_from_cps(cps)) {
					i = end - 1; // skip to end of slice
				} else { // bundle into an nfc token
					tokens.splice(start, end - start, {type: TY_NFC, input: cps0, cps, tokens: collapse_valid_tokens(slice)});
					i = start;
				}
				start = -1; // reset
			} else {
				start = i; // remember last
			}
		} else if (token.type === TY_EMOJI) {
			start = -1; // reset
		}
	}
	return collapse_valid_tokens(tokens);
}

function is_valid_or_mapped(type) {
	return type === TY_VALID || type === TY_MAPPED;
}

function requires_check(cps) {
	return cps.some(cp => NFC_CHECK.has(cp));
}

function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type === TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type === TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_normalize_post_check, ens_tokenize, nfc, nfd };
