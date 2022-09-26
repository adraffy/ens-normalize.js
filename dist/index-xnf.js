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

// created 2022-09-26T06:49:19.928Z
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
