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

// returns array of 
// [x, ys] => single replacement rule
// [x, ys, n, dx, dx] => linear map
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

function read_transposed(n, w, next) {
	let m = Array(n).fill().map(() => []);
	for (let i = 0; i < w; i++) {
		read_deltas(n, next).forEach((x, j) => m[j].push(x));
	}
	return m;
}
 
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
			let keys = read_member_array(next);
			if (keys.length == 0) break;
			branches.push({set: new Set(keys.map(i => sorted[i])), node: read()});
		}
		branches.sort((a, b) => b.set.size - a.set.size); // sort by likelihood
		let flag = next();
		let valid = flag % 3;
		flag = (flag / 3)|0;
		let fe0f = !!(flag & 1);
		flag >>= 1;
		let save = flag == 1;
		let check = flag == 2;
		return {branches, valid, fe0f, save, check};
		/*return {
			branches,
			valid: (flag & 1) != 0, 
			fe0f: (flag & 2) != 0, 
			save: (flag & 4) != 0, 
			check: (flag & 8) != 0,
		};*/
	}
}

// created 2022-08-11T04:02:21.375Z
var r = read_compressed_payload(Uint8Array.from(atob('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'), c => c.charCodeAt(0)));

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != 0xFE0F);
}

const VALID = new Set(read_member_array(r));
const IGNORED = new Set(read_member_array(r));
const MAPPED = read_mapped_map(r);
const EMOJI_ROOT = read_emoji_trie(r);
const NFC_CHECK = new Set(read_member_array(r, [...VALID].sort((a, b) => a - b)));

function nfc(s) {
	return s.normalize('NFC');
}

function ens_beautify(name) {
	return normalize(name, x => x);
}
function ens_normalize(name) {
	return normalize(name, filter_fe0f);
}

function normalize(name, emoji_filter) {
	let input = explode_cp(name).reverse(); // flip for pop
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
	return nfc(String.fromCodePoint(...output));
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
			stack.push(0xFE0F);
			if (pos > 0 && cps[pos - 1] == 0xFE0F) pos--; // consume optional FE0F
		}
		if (node.valid) { // this is a valid emoji (so far)
			emoji = stack.slice(); // copy stack
			if (node.valid == 2) emoji.splice(1, 1); // delete FE0F at position 1 (RGI ZWJ don't follow spec!)
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
			if (cp === 0x2E) {
				tokens.push({type: 'stop'});
			} else if (VALID.has(cp)) {
				tokens.push({type: TY_VALID, cps: [cp]});
			} else if (IGNORED.has(cp)) {
				tokens.push({type: TY_IGNORED, cp});
			} else {
				let cps = MAPPED[cp];
				if (cps) {
					tokens.push({type: TY_MAPPED, cp, cps});
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
					} else if (type !== TY_IGNORED || type !== TY_DISALLOWED) { 
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
					tokens.splice(start, end - start, {type: 'nfc', input: cps, cps: explode_cp(str), tokens: collapse_valid_tokens(slice)});
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

// collapse adjacent valid tokens
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

export { ens_beautify, ens_normalize, ens_tokenize };
