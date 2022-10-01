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

// created 2022-10-01T22:13:37.621Z
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
	// (script name, script-set, whole-set?)
	return [k, read_valid_subset(), i ? read_valid_subset() : 0];
});
const EXCLUDED = read_array_while(() => {
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
function check_excluded_scripts(cps) {
	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	for (let set of EXCLUDED) {
		if (cps.some(cp => set.has(cp))) { // first with one match
			if (!cps.every(cp => set.has(cp) || cp == FE0F)) { // must match all (or emoji)
				throw new Error(`excluded script cannot mix`);
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
			check_excluded_scripts(cps_nfd); // idea: it's probably safe to early terminate if this is pure
		} catch (err) {
			throw new Error(`Invalid label "${label}": ${err.message}`);
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
				tokens.push({type: TY_STOP});
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
