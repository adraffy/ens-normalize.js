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

// created 2022-10-02T06:53:28.722Z
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
