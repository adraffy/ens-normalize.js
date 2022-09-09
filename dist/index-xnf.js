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

// unsafe in the sense this expects the input to be well-formed Base64
function unsafe_atob(s) {
	let lookup = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));	
	let n = s.length;
	//while (s[n-1] === '=') n--;
	let v = new Uint8Array((6 * n) >> 3);
	for (let i = 0, width = 0, carry = 0, pos = 0; i < n; i++) {
		carry = (carry << 6) | lookup[s[i]];
		width += 6;
		if (width >= 8) {
			v[pos++] = (carry >> (width -= 8));
		}
	}
	return v;
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
function read_mapped_map(next) {
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
	return new Map(ret.flat());
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

// created 2022-09-09T07:04:46.476Z
var r = read_compressed_payload('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');

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
const MAPPED = read_mapped_map(r);
const CM = new Set(read_member_array(r, SORTED_VALID));
const EMOJI_ROOT = read_emoji_trie(r);
const NFC_CHECK = new Set(read_member_array(r, SORTED_VALID));

const STOP = 0x2E;
const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const FE0F = 0xFE0F;

function ens_normalize_post_check(norm) {
	for (let label of norm.split('.')) {
		try {
			let cps_nfc = explode_cp(label);
			for (let i = cps_nfc.lastIndexOf(UNDERSCORE) - 1; i >= 0; i--) {
				if (cps_nfc[i] !== UNDERSCORE) {
					throw new Error(`underscore only allowed at start`);
				}
			}
			if (cps_nfc.length >= 4 && cps_nfc[2] === HYPHEN && cps_nfc[3] === HYPHEN && cps_nfc.every(cp => cp < 0x80)) {
				throw new Error(`invalid label extension`);
			}
			let cps_nfd = nfd(process(label, () => [FE0F])); // replace emoji with single character
			for (let i = 0, j = -1; i < cps_nfd.length; i++) {
				if (CM.has(cps_nfd[i])) {
					if (i == 0) {
						throw new Error(`leading combining mark`);
					} else if (i == j) {
						throw new Error(`adjacent combining marks "${str_from_cps(cps_nfd.slice(i - 2, i + 1))}"`);
					} else if (cps_nfd[i - 1] == FE0F) {
						throw new Error(`emoji + combining mark`);
					}	
					j = i + 1;
				}
			}
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
function ens_beautify(name) {
	return str_from_cps(nfc(process(name, emoji => emoji))).replace(/[\u{1F1E6}-\u{1F1FF}]{2,}/gu, s => [...s].join('\u200B'));
}

/*
function is_regional_indicator(cp) {
	return 0x1F1E6 >= cp && 0x1F1FF <= cp;
}
*/

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
			continue;
		}
		let cp = input.pop();
		if (VALID.has(cp)) {
			output.push(cp);
			continue;
		} 
		if (IGNORED.has(cp)) {
			continue;
		}
		let cps = MAPPED.get(cp);
		if (cps) {
			output.push(...cps);
			continue;
		}
		throw new Error(`Disallowed codepoint: 0x${cp.toString(16).toUpperCase()}`);
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
		({node} = br);
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
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = cps.slice(); // copy stack
	if (node.valid == 2) copy.splice(1, 1); // delete FE0F at position 1 (RGI ZWJ don't follow spec!, see: make.js)
	return copy;
}

// return all supported emoji
function ens_emoji() {
	let ret = [];
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
				tokens.push({type: TY_VALID, cps: [cp]});
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
				let str0 = str_from_cps(cps0);
				let cps = nfc(cps0); // this does extra work for nf-native but oh well
				let str = str_from_cps(cps);
				if (str0 === str) {
					i = end - 1; // skip to end of slice
				} else {
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
