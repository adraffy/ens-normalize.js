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

// created 2022-10-02T06:49:37.946Z
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
