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

// created 2022-09-22T11:40:07.516Z
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
const CM = new Set(read_member_array(r, SORTED_VALID));
const ISOLATED = new Set(read_member_array(r, SORTED_VALID));
const EMOJI_SOLO = new Set(read_member_array(r));
const EMOJI_ROOT = read_emoji_trie(r);
const NFC_CHECK = new Set(read_member_array(r, SORTED_VALID));

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

// requires decomposed codepoints
function check_cm(cps) {
	for (let i = 0, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			if (i == 0) {
				throw new Error(`leading combining mark`);
			} else if (i == j) {
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i - 2, i + 1))}"`);
			} else {
				let prev = cps[i - 1];
				if (prev == FE0F || ISOLATED.has(prev)) {
					throw new Error(`illegal combining mark`);
				}
			}	
			j = i + 1;
		}
	}
}

function ens_normalize_post_check(norm) {
	for (let label of norm.split('.')) {
		if (!label) throw new Error('Empty label');
		try {
			let cps_nfc = explode_cp(label);
			check_leading_underscore(cps_nfc);
			check_label_extension(cps_nfc);
			check_surrounding(cps_nfc, 0x2019, 'apostrophe', true, true);
			check_middle_dot(cps_nfc);
			// replace emoji with single character
			let cps_nfd = nfd(process(label, () => [FE0F])); 
			check_cm(cps_nfd);
		} catch (err) {
			throw new Error(`Invalid label "${label}": ${err.message}`);
		}
	}
	return norm;
}

function ens_normalize_fragment(frag) {
	return str_from_cps(nfc(process(frag, filter_fe0f)));
}

function ens_normalize(name) {
	return ens_normalize_post_check(ens_normalize_fragment(name));
}

// note: does not post_check
// insert 200B between regional indicators so they do not collapse into flags
// alternative solution: only allow valid flags
function ens_beautify(name) {
	return str_from_cps(nfc(process(name, x => x))).replace(/[\u{1F1E6}-\u{1F1FF}]{2,}/gu, s => [...s].join('\u200B'));
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
			} else if (!IGNORED.has(cp)) {
				let cps = MAPPED.get(cp);
				if (cps) {
					output.push(...cps);
				} else {
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
