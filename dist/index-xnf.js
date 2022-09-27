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

// created 2022-09-27T07:59:16.353Z
var r = read_compressed_payload('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');

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
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
		if (cps.some(cp => set.has(cp)) && !cps.every(cp => set.has(cp) || cp == FE0F)) {
			throw new Error(`excluded script cannot mix`);
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
			check_surrounding(cps_nfc, 0x2019, 'apostrophe', true, true);
			check_middle_dot(cps_nfc);
			check_scripts_latin_like(cps_nfc);
			// replace emoji with single character
			let cps_nfd = nfd(process(label, () => [FE0F])); 
			check_combinining_marks(cps_nfd);
			check_excluded_scripts(cps_nfd);
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
