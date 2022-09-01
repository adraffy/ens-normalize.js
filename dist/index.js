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
function read_compressed_payload(bytes) {
	return read_payload(decode_arithmetic(bytes));
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
	return Object.fromEntries(ret.flat());
}

function read_zero_terminated_array(next) {
	let v = [];
	while (true) {
		let i = next();
		if (i == 0) break;
		v.push(i);
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
	let vN = read_zero_terminated_array(next);
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

// created 2022-09-01T08:47:35.877Z
var r = read_compressed_payload(Uint8Array.from(atob('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'), c => c.charCodeAt(0)));

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != 0xFE0F);
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
			let cps_nfd = explode_cp(nfd(process(label, () => [FE0F]))); // replace emoji with single character
			for (let i = 0, j = -1; i < cps_nfd.length; i++) {
				if (CM.has(cps_nfd[i])) {
					if (i == 0) {
						throw new Error(`leading combining mark`);
					} else if (i == j) {
						throw new Error(`adjacent combining marks "${String.fromCodePoint(...cps_nfd.slice(i - 2, i + 1))}"`);
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
	return nfc(process(frag, emoji => emoji.filter(cp => cp != FE0F)));
}

function ens_normalize(name) {
	return ens_normalize_post_check(ens_normalize_fragment(name));
}

// note: does not post_check
function ens_beautify(name) {
	return nfc(process(name, emoji => emoji));
}

// warning: Unicode support
// 14.0.0 expected
// 13.0.0 (node) appears to pass all tests
// 11.0.0 (node) fails 1 test
function nfc(s) {
	return s.normalize('NFC'); 
}
function nfd(s) {
	return s.normalize('NFD');
}

function process(name, emoji_filter) {
	let input = explode_cp(name).reverse(); // flip so we can pop
	let output = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			output.push(...emoji_filter(emoji));
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
		let cps = MAPPED[cp];
		if (cps) {
			output.push(...cps);
			continue;
		}
		throw new Error(`Disallowed codepoint: 0x${cp.toString(16).toUpperCase()}`);
	}
	return String.fromCodePoint(...output);
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
		node = node.branches.find(x => x.set.has(cp))?.node;
		if (!node) break;
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
			emoji = stack.slice(); // copy stack
			if (node.valid == 2) emoji.splice(1, 1); // delete FE0F at position 1 (RGI ZWJ don't follow spec!, see: make.js)
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	return emoji;
}

// ************************************************************
// tokenizer (use "only-norm.js" if just above is needed)

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
				let cps = MAPPED[cp];
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
				let cps = slice.flatMap(x => is_valid_or_mapped(x.type) ? x.cps : []); // strip junk tokens
				let str0 = String.fromCodePoint(...cps);
				let str = nfc(str0);
				if (str0 === str) {
					i = end - 1; // skip to end of slice
				} else {
					tokens.splice(start, end - start, {type: TY_NFC, input: cps, cps: explode_cp(str), tokens: collapse_valid_tokens(slice)});
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

export { ens_beautify, ens_normalize, ens_normalize_fragment, ens_normalize_post_check, ens_tokenize };
