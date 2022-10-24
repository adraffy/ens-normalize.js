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

// read a list of non-empty lists
// where 0 is terminal
// [1 0 1 2 0 0] => [[1],[1,2]]
function read_sequences(next) {
	return read_array_while(() => {
		let v = read_array_while(next);
		if (v.length) return v.map(x => x - 1);
	});
}

// created 2022-10-24T18:13:16.532Z
var r = read_compressed_payload('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');
const ORDERED_SCRIPTS = [{"name":"Korean","test":[1],"rest":[0,2]},{"name":"Japanese","test":[3,4],"rest":[0,2]},{"name":"Han","test":[2],"rest":[0]},{"name":"Latin","test":[5],"rest":[0]},{"name":"Cyrillic","test":[6],"rest":[0]},{"name":"Greek","test":[7],"rest":[0]},{"name":"Arabic","test":[8],"rest":[]},{"name":"Devanagari","test":[9],"rest":[]},{"name":"Hebrew","test":[10],"rest":[]},{"name":"Thai","test":[11],"rest":[]}];

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function quote_cp(cp) {
	return `{${hex_cp(cp)}}`; // raffy convention: like "\u{X}" w/o the "\u"
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
	const chunk = 4096;
	let len = cps.length;
	if (len < chunk) return String.fromCodePoint(...cps);
	let buf = [];
	for (let i = 0; i < len; ) {
		buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
	}
	return buf.join('');
}

function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
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
function read_set(lookup) {
	return new Set(read_member_array(r, lookup));
}
function read_valid_subset() {
	return read_set(SORTED_VALID);
}
function read_valid_subsets() {
	return read_array_while(() => { 
		let v = read_valid_subset();
		if (v.size) return v;
	});
}
const VALID = new Set(SORTED_VALID);
const IGNORED = read_set();
const MAPPED = new Map(read_mapped(r));
const CM = read_valid_subset();
const CM_ISOLATED_PH = [];
const CM_WHITELIST = new Map([
	read_array_while(() => {
		let cp = r();
		if (cp) return [cp, read_sequences(r)];
	}),
	read_member_array(r, SORTED_VALID).map(cp => [cp, CM_ISOLATED_PH]),
].flat());
const SCRIPTS = read_valid_subsets(); // [0] is ALL
const ORDERED = ORDERED_SCRIPTS.map(({name, test, rest}) => {
	test = test.map(i => SCRIPTS[i]);
	rest = [test, rest.map(i => SCRIPTS[i])].flat();
	return {name, test, rest, extra: read_valid_subset(), wholes: read_valid_subset()};
});
const RESTRICTED_WHOLES = read_valid_subset();
const RESTRICTED = read_valid_subsets();
const EMOJI_SOLO = read_set();
const EMOJI_ROOT = read_emoji_trie(r);
const NFC_CHECK = read_valid_subset();
const ESCAPE = read_set();
const CM_INVALID = read_set();

const STOP = 0x2E;
const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const FE0F = 0xFE0F;

const COMMON = 'Common';
const STOP_CH = str_from_cps([STOP]);

function check_leading_underscore(cps) {
	let e = cps.lastIndexOf(UNDERSCORE);
	for (let i = e; i > 0; ) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error(`underscore allowed only at start`);
		}
	}
	return e + 1;
}

function safe_str_from_cps(cps, quoter = quote_cp) {
	let buf = [];
	if (is_printable_mark(cps[0])) buf.push('◌');
	let prev = 0;
	let n = cps.length;
	for (let i = 0; i < n; i++) {
		let cp = cps[i];
		if (should_escape(cp)) {
			buf.push(str_from_cps(cps.slice(prev, i)));
			buf.push(quoter(cp));
			prev = i + 1;
		}
	}
	buf.push(str_from_cps(cps.slice(prev, n)));
	return buf.join('');
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

/*
// ContextO: MIDDLE DOT
// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
// Between 'l' (U+006C) characters only, used to permit the Catalan character ela geminada to be expressed.
// note: this a lot of effort for 1 character
// 20221020: disabled
function check_middle_dot(cps) {
	let i = 0;
	while (true) {
		i = cps.indexOf(0xB7, i);
		if (i == -1) break;
		if (cps[i-1] !== 0x6C || cps[i+1] !== 0x6C) throw new Error('ContextO: middle dot');
		i += 2;
	}
}
*/

function check_scripts(cps) {
	for (let {name, test, rest, extra, wholes} of ORDERED) {
		if (cps.some(cp => test.some(set => set.has(cp)))) {
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			let bad = cps.find(cp => !rest.some(set => set.has(cp)) && !extra.has(cp)); // should just show first char
			if (bad >= 0) {
				throw new Error(`mixed-script ${name} confusable: "${str_from_cps([bad])}"`);
			}
			// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
			if (cps.every(cp => wholes.has(cp) || SCRIPTS[0].has(cp))) {
				throw new Error(`whole-script ${name} confusable`);
			}
			return name;
		}
	}
	return COMMON;
}

// requires decomposed codepoints
// returns true if pure (emoji or single script)
function check_restricted_scripts(cps) {
	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	cps = cps.filter(cp => cp != FE0F); // remove emoji (once)
	if (!cps.length) return true; // purely emoji
	for (let set of RESTRICTED) {
		if (cps.some(cp => set.has(cp))) { // first with one match
			if (!cps.every(cp => set.has(cp))) { // must match all
				throw new Error(`restricted script cannot mix`);
			}
			if (cps.every(cp => RESTRICTED_WHOLES.has(cp))) {
				throw new Error(`restricted whole-script confusable`);
			}
			return true;
		}
	}
}

// requires decomposed codepoints
function check_combinining_marks(cps) {
	for (let i = 1, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			let prev = cps[i - 1];
			if (prev == FE0F) {
				throw new Error(`emoji + combining mark: ${str_from_cps(cps.slice(i-1, i+1))}`);
			}
			let seqs = CM_WHITELIST.get(prev);
			if (seqs) {
				let k = i + 1;
				while (k < cps.length && CM.has(cps[k])) k++;
				let cms = cps.slice(i, k);
				let match = seqs.find(seq => !compare_arrays(seq, cms));
				if (!match) {
					throw new Error(`disallowed combining mark sequence: "${str_from_cps(cps.slice(i-1, k))}"`)
				}
				i = k; 
			} else if (i == j) { 
				// this needs to come after whitelist test since it can permit 2+
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i-2, i+1))}"`);
			} else {
				j = i + 1;
			}
		}
	}
}

function is_printable_mark(cp) {
	return CM.has(cp) || CM_INVALID.has(cp);
}

function should_escape(cp) {
	return ESCAPE.has(cp);
}

function ens_normalize_fragment(frag, nf = nfc) {
	return frag.split(STOP_CH).map(label => str_from_cps(nf(process(explode_cp(label))))).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(ens_split(name));
}

function ens_beautify(name) {
	return flatten(ens_split(name, x => x));
}

function ens_split(name, emoji_filter = filter_fe0f) {
	let offset = 0;
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint not string!
		};
		offset += input.length + 1;
		try {
			let mapped = info.mapped = process(input);
			let norm = info.output = nfc(mapped.flatMap(x => Array.isArray(x) ? emoji_filter(x) : x)); // strip FE0F from emoji
			info.emoji = mapped.some(x => Array.isArray(x)); // mapped.reduce((a, x) => a + (Array.isArray(x)?1:0), 0);
			check_leading_underscore(norm); // should restricted get underscores? (20221018: no)
			if (CM.has(norm[0])) throw new Error(`leading combining mark`);
			check_label_extension(norm);
			let decomp = nfd(mapped.map(x => Array.isArray(x) ? FE0F : x)); // replace emoji with single character placeholder
			if (check_restricted_scripts(decomp)) {
				info.script = mapped.every(x => Array.isArray(x)) ? COMMON : 'Restricted';
			} else {
				check_combinining_marks(decomp);			
				check_surrounding(norm, 0x2019, 'apostrophe', true, true); // question: can this be generalized better?
				//check_middle_dot(norm);
				info.script = check_scripts(nfc(mapped.flatMap(x => Array.isArray(x) ? [] : x))); // remove emoji
			}
		} catch (err) {
			info.error = err.message;
		}
		return info;
	});
}

// throw on first error
function flatten(split) {
	return split.map(({input, error, output}) => {
		// don't print label again if just a single label
		if (error) throw new Error(split.length == 1 ? error : `Invalid label "${safe_str_from_cps(input)}": ${error}`);
		return str_from_cps(output);
	}).join(STOP_CH);
}

function process(input) {
	let ret = []; 
	input = input.slice().reverse(); // flip so we can pop
	while (input.length) {
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			ret.push(emoji);
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				ret.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					ret.push(...cps);
				} else if (!IGNORED.has(cp)) {
					let form = should_escape(cp) ? '' : ` "${safe_str_from_cps([cp])}"`;
					throw new Error(`disallowed character:${form} ${quote_cp(cp)}`); 
				}
			}
		}
	}
	return ret;
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
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

// return all supported emoji
function ens_emoji() {
	let ret = [...EMOJI_SOLO].map(x => [x]);
	build(EMOJI_ROOT, []);
	return ret.sort(compare_arrays);
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

function ens_tokenize(name, {
	nf = true, // collapse unnormalized runs into a single token
} = {}) {
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
				tokens.push({type: TY_STOP, cp});
			} else if (VALID.has(cp)) {
				/*
				if (CM_WHITELIST.get(cp) === CM_ISOLATED_PH) {
					tokens.push({type: TY_ISOLATED, cp});
				} else {
					tokens.push({type: TY_VALID, cps: [cp]});
				}
				*/
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
	if (nf) {
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
					let cps = nfc(cps0);
					if (compare_arrays(cps, cps0)) { // bundle into an nfc token
						tokens.splice(start, end - start, {type: TY_NFC, input: cps0, cps, tokens: collapse_valid_tokens(slice)});
						i = start;
					} else { 
						i = end - 1; // skip to end of slice
					}
					start = -1; // reset
				} else {
					start = i; // remember last
				}
			} else if (token.type === TY_EMOJI) {
				start = -1; // reset
			}
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

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, is_printable_mark, nfc, nfd, safe_str_from_cps, should_escape };
