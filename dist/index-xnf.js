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

// created 2022-10-11T06:41:57.020Z
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
