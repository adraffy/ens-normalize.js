class TableReader {
	constructor(table) {
		this.table = table;
		this.pos = 0;
	}
	get more() {
		return this.pos < this.table.length;
	}
	read_byte() { return this.table[this.pos++]; }
	read() { // unsigned pseudo-huffman (note: assumes tables are valid)
		let {table, pos} = this;
		let x0 = table[pos];
		if (x0 < 0x80) {
			this.pos += 1;
			return x0;
		}
		if (x0 < 0xFF) {
			this.pos += 2;
			return 0x80 + (((x0 & 0x7F) << 8) | table[pos+1]);
		}
		this.pos += 4;
		return 0x7F80 + ((table[pos+1] << 16) | (table[pos+2] << 8) | table[pos+3]);
	}
	read_signed() { // eg. [0,1,2,3...] => [0,-1,1,-2,...]
		let i = this.read();		
		return (i & 1) ? (~i >> 1) : (i >> 1);
	}
}


// from coder-v2.js
function bytes_from_base64(s) {
	return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function decode2(v) {
	let buf = 0;
	let n = 0;
	let ret = [];
	next: for (let x of v) {
		buf = (buf << 8) | x;
		n += 8;
		while (n >= 3) {
			switch ((buf >> (n - 2)) & 3) { // upper 2 bits
				case 3:
					if (n < 10) continue next;
					ret.push((buf >> (n -= 10)) & 255);
					continue;
				case 2: 
					if (n < 6) continue next;
					ret.push((buf >> (n -= 6)) & 15);
					continue;
				default:
					ret.push((buf >> (n -= 3)) & 3); 
			}
		}
	}
	return ret;
}

// compressed lookup tables
// Ignored/Disallowed/Mapped/Valid/Deviation [IdnaMappingTable.txt]
const TABLE_I = decompress('i');
const TABLE_D = decompress('d');
const TABLE_N = decompress('l');
const TABLE_W = [decompress('1'), decompress('2'), decompress('3'), decompress('4'), decompress('5'), decompress('6')];
// CheckJoiners [DerivedGeneralCategory.txt]
const TABLE_M = decompress('m');
// CONTEXTJ [DerivedCombiningClass.txt, DerivedJoiningType.txt]  
const TABLE_V = decompress('V');
const TABLE_LD = decompress('L');
const TABLE_RD = decompress('R');
const TABLE_T = decompress('T');
// emoji-zwj-sequences.txt
const ZWNJ_EMOJI = (() => {
	let r = new TableReader(decompress('E'));
	let buckets = []; // stored by zwnj position
	while (r.more) {
		let n = r.read();       // group size
		let w = r.read_byte();  // group width
		let p = r.read();       // bit positions of zwnj
		let m = [];
		for (let i = 0; i < n; i++) m.push([]);
		let z = []; // position of zwnj
		for (let i = 0; i < w; i++) { // signed delta-encoded, transposed
			if (p & (1 << (i - 1))) {
				z.push(i);
				m.forEach(v => v.push(0x200D)); // insert zwnj
			} else {
				let y = 0;
				for (let v of m) v.push(y += r.read_signed());
			}
		}
		for (let b of z) {
			let bucket = buckets[b];
			if (!bucket) buckets[b] = bucket = [];
			bucket.push(...m);
		}
	}
	// assumption: zwnj is never the first character
	// so buckets[0] = undefined
	buckets.forEach((v, i) => {
		if (!v) return;
		v.sort((a, b) => a[i - 1] - b[i - 1]); // sort by the point before the zwj (not yet used)
	});
	return buckets;
})();

export const DEBUG = {TABLE_I, TABLE_D, TABLE_N, TABLE_W, TABLE_M, TABLE_V, TABLE_LD, TABLE_RD, TABLE_T, ZWNJ_EMOJI};

export function is_zwnj_emoji(v, pos) {
	let {length} = v;
	for (let b = Math.min(pos, ZWNJ_EMOJI.length); b > 0; b--) {
		let bucket = ZWNJ_EMOJI[b];
		if (!bucket) continue;
		next: for (let emoji of bucket) { // TODO: early abort 
			let i = pos - b;
			for (let c of emoji) {
				if (i >= length) continue next;
				let ci = v[i];			
				if (ci === 0xFE0F) { // this could be is_ignored()
					i++; // skip
					continue;
				} else if (c != v[i++]) {
					continue next;
				}
			}
			return true;
		}
	}
	return false;
}

// member are 1-tuples [unsigned(cp)]
function lookup_member(table, cp) {
	let x = 0;
	let r = new TableReader(table); 
	while (r.more) {
		x += r.read();
		if (x == cp) return true;
		if (x > cp) break;
	}
	return false;
}

// member are 2-tuples [unsigned(cp), n] 
function lookup_member_span(table, cp) {
	let x = 0;
	let r = new TableReader(table); 
	while (r.more) {
		x += r.read();
		let d = cp - x;
		if (d < 0) break;
		let n = r.read();
		if (d < n) return true;
		x += n;
	}
	return false;
}

// linear are 3-tuples [unsigned(cp), n, signed(mapped)]
function lookup_linear(table, cp) {
	let x = 0, y = 0;
	let r = new TableReader(table);
	while (r.more) {
		x += r.read();
		let d = cp - x;
		if (d < 0) break;
		let n = r.read();
		y += r.read_signed();		
		if (d < n) return y + d;
		x += n;
	}
}

// mapped are (1+w)-tuples [unsigned(cp), signed(mapped...)]
function lookup_mapped(table, width, cp) {
	let x = 0, y = 0;
	let r = new TableReader(table);
	let i = 0;
	while (r.more) {		
		x += r.read();
		if (x > cp) break;
		if (x == cp) {
			let v = [];
			for (let j = 0; j < width; j++) {
				v.push(y += r.read_signed());
			}
			return v;
		}
		for (let j = 0; j < width; j++) {
			y += r.read_signed();
		}	
	}
}

// adapted from https://github.com/mathiasbynens/punycode.js
// overflow removed because only used after idna
// note: not safe to export for general use
// string -> string
function puny_decode(input) {
	let output = [];
	
	let index = input.lastIndexOf('-');
	for (let i = 0; i < index; ++i) {
		let code = input.charCodeAt(i);
		if (code >= 0x80) throw new Error('punycode: expected basic');
		output.push(code);
	}
	index++; // skip delimiter
	
	// https://datatracker.ietf.org/doc/html/rfc3492#section-3.4
	const BASE = 36; 
	const T_MIN = 1;
	const T_MAX = 26;
	const DELTA_SKEW = 38;
	const DELTA_DAMP = 700;
	const BASE_MIN = BASE - T_MIN;
	const MAX_DELTA = (BASE_MIN * T_MAX) >> 1;

	let bias = 72;
	let n = 0x80;

	let i = 0;
	const {length} = input;
	while (index < length) {
		let prev = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (index >= length) throw new Error('punycode: invalid');
			let code = input.charCodeAt(index++)
			if (code < 0x3A) { // 30 + 0A
				code -= 0x16;
			} else if (code < 0x5B) { // 41 + 1A
				code -= 0x41;
			} else if (code < 0x7B) { // 61 + 1A
				code -= 0x61;
			} else {
				throw new Error(`punycode: invalid byte ${code}`);
			}
			i += code * w;
			const t = k <= bias ? T_MIN : (k >= bias + T_MAX ? T_MAX : k - bias);
			if (code < t) break;
			w *= BASE - t;
		}
		const out = output.length + 1;
		let delta = i - prev;
		delta = prev == 0 ? (delta / DELTA_DAMP)|0 : delta >> 1;
		delta += (delta / out)|0;
		let k = 0;
		while (delta > MAX_DELTA) {
			delta = (delta / BASE_MIN)|0;
			k += BASE;
		}
		bias = (k + BASE * delta / (delta + DELTA_SKEW))|0;
		n += (i / out)|0;
		i %= out;
		output.splice(i++, 0, n);
	}	
	return String.fromCodePoint(...output);
}

// warning: these should not be used directly
// expects code-point (number)
// is_* returns boolean
// get_* returns number, list of numbers, or undefined (code-points)
export function is_disallowed(cp) {
	return lookup_member_span(TABLE_D, cp);
}
export function is_ignored(cp) {
	return lookup_member_span(TABLE_I, cp);
}
export function is_combining_mark(cp) {
    return lookup_member_span(TABLE_M, cp);
}
export function get_mapped(cp) {
	let mapped = lookup_linear(TABLE_N, cp);
	if (mapped) return mapped;
	for (let i = 0; i < TABLE_W.length; i++) {	
		mapped = lookup_mapped(TABLE_W[i], i + 1, cp);
		if (mapped) return mapped;
	}
}

class DisallowedError extends Error {
	constructor(message, cp, i) {
		super(message);
		this.codePoint = cp;
		this.offset = i;
	}
}

// expects a string 
// throws TypeError if not a string
// returns a string normalized according to IDNA 2008, according to UTS-46 (v14.0.0), +CONTEXTJ, +ZWJ EMOJI
export function idna(s, ignore_disallowed = false) {
	if (typeof s !== 'string') throw new TypeError('expected string');
	let v =  [...s].map(x => x.codePointAt(0)); // convert to code-points
	const empty = [];
	return String.fromCodePoint(...v.map((cp, i) => {
		if (is_disallowed(cp)) {
			if (ignore_disallowed) return empty;
			throw new DisallowedError(`disallowed: 0x${cp.toString(16).padStart(2, '0')}`, cp, i);
		}
		if (is_ignored(cp)) return empty;
		if (cp === 0x200C) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(TABLE_V, v[i - 1])) { 
				return cp; // allowed
			}
			// rule 2: {L,D} + T* + cp + T* + {R,D}
			// L,D,T,R = Joining_Type
			if (i > 0 && i < v.length - 1) { // there is room on either side
				let head = i - 1;
				while (head > 1 && lookup_member_span(TABLE_T, v[head])) head--; // T*
				if (lookup_member_span(TABLE_LD, v[head])) { // L or D
					let tail = i + 1;
					while (tail < v.length - 1 && lookup_member_span(TABLE_T, v[tail])) tail++; // T*
					if (lookup_member_span(TABLE_RD, v[tail])) { // R or D
						return cp; // allowed
					}
				}
			}
			if (ignore_disallowed) return empty;
			throw new DisallowedError(`ZWJ outside of context`, cp, i);
		} else if (cp === 0x200D) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(TABLE_V, v[i - 1])) { 
				return cp; // allowed
			}
			// custom rule: emoji
			if (is_zwnj_emoji(v, i)) {
				return cp; // allowed
			}
			if (ignore_disallowed) return empty; 
			throw new DisallowedError(`ZWNJ outside of context`, cp, i);
		}
		return get_mapped(cp) ?? cp;
	}).flat()).normalize('NFC');
}

// primary api
// expects a string 
// throws TypeError if not a string
// returns a normalized string ready for namehash
// throws Error if not normalizable
export function ens_normalize(name, ignore_disallowed = false) { // https://unicode.org/reports/tr46/#Processing
	// idna() will:
	// 1. map all full-stops to "." (see: Section 2.3 and Section 4.5)
	// 2. apply ContextJ rules (see: Section 4.1 Rule #7) [as-of v14.0.0, ContextJ does not span a stop]
	// 3. apply Section 4 Processing Rule #1 (Map) and Rule #2 (Normalize)
	return idna(name, ignore_disallowed).split('.').map(label => { // Section 4 Processing Rule #3 (Break) + Section 4.1 Rule #4
		if (label.startsWith('xn--')) { // Rule #4 (Convert)
			label = idna(puny_decode(label.slice(4)), ignore_disallowed);
		}
		// Section 4.1 Rule #1 (NFC) is already satisfied by idna()
		// apply Section 4.1 Rule #2
		if (label.length >= 4 && label[2] == '-' && label[3] == '-') throw new Error(`double-hyphen at label[3:4]: ${label}`);
		// apply Section 4.1 Rule #3
		if (label.startsWith('-')) throw new Error(`hyphen at label start: ${label}`);
		if (label.endsWith('-')) throw new Error(`hyphen at label end: ${label}`);
		// apply Section 4.1 Rule #5
		if (label.length > 0 && is_combining_mark(label.codePointAt(0))) throw new Error(`mark at label start: ${label}`);
		// Section 4.1 Rule #6 (Valid) is satisfied by idna() following EIP-137 (transitional=N, useSTD3AsciiRules=Y)
		// Section 4.1 Rule #7 (ContextJ) is satisfied by idna() 
		// Section 4.1 Rule #8 NYI
		return label;
	}).join('.');
}