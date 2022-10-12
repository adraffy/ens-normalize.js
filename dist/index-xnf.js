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

// created 2022-10-12T08:32:43.616Z
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
