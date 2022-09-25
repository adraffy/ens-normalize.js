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

// created 2022-09-25T20:27:19.051Z
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
