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

function read_transposed(n, w, next, lookup) {
	let m = Array(n).fill().map(() => []);
	for (let i = 0; i < w; i++) {
		read_deltas(n, next).forEach((x, j) => m[j].push(lookup ? lookup(x) : x));
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
		branches.sort((a, b) => b.set.size - a.set.size);
		let flag = next();
		return {
			branches,
			valid: (flag & 1) != 0, 
			fe0f: (flag & 2) != 0, 
			save: (flag & 4) != 0, 
			check: (flag & 8) != 0,
		};
	}
}

// created 2022-08-10T16:47:14.118Z
var r = read_compressed_payload(Uint8Array.from(atob('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'), c => c.charCodeAt(0)));

const VALID = new Set(read_member_array(r));
const IGNORED = new Set(read_member_array(r));
const MAPPED = read_mapped_map(r);
const EMOJI_ROOT = read_emoji_trie(r);
const NFC_CHECK = new Set(read_member_array(r, [...VALID].sort((a, b) => a - b)));
const FE0F = 0xFE0F;

function nfc(s) {
	return s.normalize('NFC');
}

function explode_cp(s) {
	return [...s].map(x => x.codePointAt(0));
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
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
		let emoji = consume_emoji_reversed(input, EMOJI_ROOT);
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

function consume_emoji_reversed(cps, node, eaten) {
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
			if (pos > 0 && cps[pos - 1] == FE0F) pos--;
		}
		if (node.valid) { // this is a valid emoji (so far)
			emoji = stack.slice(); // copy stack
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
		let emoji = consume_emoji_reversed(input, EMOJI_ROOT, eaten);
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
