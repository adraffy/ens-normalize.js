export const VERSION = '1.1.1';
export const UNICODE = '14.0.0';
// injected from ./decoder.js
class Decoder {
	constructor(bytes) {
		let buf = 0;
		let n = 0;
		let ret = [];
		next: for (let x of bytes) {
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
		this.buf = ret;
		//this.buf = bytes;
		this.pos = 0;
	}
	/*
	get more() {
		return this.pos < this.table.length;
	}
	*/
	// unsigned pseudo-huffman
	// note: no overflow check
	read() { 
		let {buf, pos} = this;
		let x0 = buf[pos];
		if (x0 < 0x80) {
			this.pos += 1;
			return x0;
		}
		if (x0 < 0xFF) {
			this.pos += 2;
			return 0x80 + (((x0 & 0x7F) << 8) | buf[pos+1]);
		}
		this.pos += 4;
		return 0x7F80 + ((buf[pos+1] << 16) | (buf[pos+2] << 8) | buf[pos+3]);
	}
	read_signed() { // eg. [0,1,2,3...] => [0,-1,1,-2,...]
		let i = this.read();		
		return (i & 1) ? (~i >> 1) : (i >> 1);
	}
	read_counts(n) {
		let v = Array(n);
		for (let i = 0; i < n; i++) v[i] = this.read() + 1;
		return v;
	}
	read_ascending(n) {
		let v = Array(n);
		for (let i = 0, x = 0; i < n; i++, x++) v[i] = x += this.read();
		return v;
	}
	read_deltas(n) {
		let v = Array(n);
		for (let i = 0, x = 0; i < n; i++) v[i] = x += this.read_signed();
		return v;
	}
	// returns [[x, n], ...] s.t. [x,3] == [x,x+1,x+2]
 	read_member_table() {
		let v1 = this.read_ascending(this.read());
		let n = this.read();
		let vX = this.read_ascending(n);
		let vN = this.read_counts(n);
		return [
			...v1.map(x => [x, 1]),
			...vX.map((x, i) => [x, vN[i]])
		].sort((a, b) => a[0] - b[0]);
	}
	// returns array of 
	// [x, ys] => single replacement rule
	// [x, ys, n, dx, dx] => linear map
	read_mapped_table() {
		let ret = [];
		for (let n = this.read(), i = 0; i < n; i++) {
			ret.push(this.read_linear_table());
		}
		for (let n = 1 + this.read(), i = 1; i < n; i++) {
			ret.push(this.read_mapped_replacement(i));
		}
		return ret.flat().sort((a, b) => a[0] - b[0]);
	}
	read_ys_transposed(n, w) {
		let m = [this.read_deltas(n)];
		for (let j = 1; j < w; j++) {
			let v = Array(n);
			let prev = m[j - 1];
			for (let i = 0; i < n; i++) {
				v[i] = prev[i] + this.read_signed();
			}
			m.push(v);
		}
		return m;
	}
	read_mapped_replacement(w) { 
		let n = this.read();
		let vX = this.read_ascending(n);
		let mY = this.read_ys_transposed(n, w);
		return vX.map((x, i) => [x, mY.map(v => v[i])])
	}
	read_linear_table() {
		let w = 1 + this.read();
		let dx = 1 + this.read();
		let dy = this.read();
		let n = 1 + this.read();
		let vX = this.read_ascending(n);
		let vN = this.read_counts(n);
		let mY = this.read_ys_transposed(n, w);
		return vX.map((x, i) => [x, mY.map(v => v[i]), vN[i], dx, dy]);
	}
	read_emoji() {
		let buckets = [];
		for (let N = this.read(); N > 0; N--) {
			let n = 1 + this.read(); // group size
			let w = 1 + this.read(); // group width w/o ZWNJ
			let p = 1 + this.read(); // bit positions of zwnj
			let z = []; // position of zwnj
			let m = []; // columns of cp
			for (let i = 0; i < n; i++) m.push([]);
			for (let i = 0; i < w; i++) { // signed delta-encoded, transposed
				if (p & (1 << (i - 1))) {
					w++; // increase width
					z.push(i); // remember position
					m.forEach(v => v.push(0x200D)); // insert zwnj
				} else {
					this.read_deltas(n).forEach((x, i) => m[i].push(x));
				}
			}
			for (let b of z) {
				let bucket = buckets[b];
				if (!bucket) buckets[b] = bucket = [];
				bucket.push(...m);
			}
		}
		return buckets;
	}
}
// injected from ./utils.js
function escape_unicode(s) {
	return s.replace(/[^\.\-a-z0-9]/igu, x => `{${x.codePointAt(0).toString(16).toUpperCase()}}`);
}
// compressed lookup tables
let r = new Decoder(Uint8Array.from(atob('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BAAAAAAAAACcAAAAAAAAAIAAAAAAAAAIAAAAAAAAAIAAAAAAAAAIAAAAAAAAATgAAAAAAAABAAAAAAAAABAAAAAAAAABAAAAAAAAABAAAAAAAAACcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIIThBBBCcIIIITgBABABABACcAIAIAIAIATgBABABABAD/3s/EAAf+8a11cBsn/vGPs2rEsuyKjgJpOBxxcBq1XBZRknC91jS/95N564DZP/eMfZtWJZdkVHATScDji4DVquCyjJOF7rGl/7ybz1wGyf+8Y+zasSy7IqOAmk4HHFwGrVcFlGScL3WNL/3k3nrgNk/94x9m1Yll2RUcBNJwOOLgNWq4LKMk4XusaX/vJvPXAbJ/7xj7NqxLLsio4CaTgccXAatVwWUZJwvdY0v/eTeeuA2T/3jH2bViWXZFRwE0nA44uA1argsoyThe6xpf+8m89cBsn/vGPs2rEsuyKjgJpOBxxcBq1XBZRknC91jS/95N564DZP/eMfZtWJZdkVHATScDji4DVquCyjJOF7rGl/7ybz1wGyf+8Y+zasSy7IqOAmk4HHFwGrVcFlGScL3WNL/3k3nrgNk/94x9m1Yll2RUcBNJwOOLgNWq4LKMk4XusaX/vJvPXAbJ/7xj7NqxLLsio4CaTgccXAatVwWUZJwvdY0v/eTeeuA2T/3jH2bViWXZFRwE0nA44uA1argsoyThe6xpf+8m89cBsn/vGPs2rEsuyKjgJpOBxxcBq1XBZRknC91jS/95N564DZP/eMfZtWJZdkVHATScDji4DVquCyjJOF7rGl/7ybz1wGyf+8Y+zasSy7IqOAmk4HHFwGrVcFlGScL3WNL/3k+8yORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyORyf+8n1xJSpKVJSpKVJSpKVJSpKVJSpKVJSpKVJSpKVJYmz/73bYgAAAAAAAAB/72jdgAgAgAgAgB/73bZAAAAAAAAAB/72jeElPIlOpFOlJOkpQDwHD6DuFuL8BmGT8Ddo8qxHWVfwHQcdo3EVWZZuSsbVClTKzqmRJcB5d999+P6fj9/AV14rJt12JOTEDkl/A5XwHbarjPDdfvvB51wG7sqZ04qaU6SlwGrFnar6Zpf3/Tzth4DTzrGQy08D8+Qkk43kRJLLLbbJJbbbc7bbZOOLEMfx1YlfTNOmVM7J555aOD5bgMv4DP675+B2ym2mSpcJpPF8/6uP/Ln+M4zjM+I4zjczknmnqxnGVLRPjKkpnxnGcZxnGcZxnGcZxnGcZx3EZ8RtxGfEbcRnxG3EZ8RtxGfEcRpppp5DieE3+mrFKs2oqc1OK08D/XFZ//43zuNX3PT+AyLGTi0xJRxChX4/kspypGckklEkpklTyzzyzkmWlkolkkmjGcZy8klSqnFCSZCiSjIZZJXp5KJJJJLJJJJJJJJJJJJJJJJJJpxnGSTLJKSVKqZZZUXk+R1XTEkklZlj+P4zjOMzYjjOMkudzVYzjJc82MlyTYzjOM4zjOM4zjOM4zjOM4ziE2ITYhNiE2ITYhNiE2ITYhNiE1NNNNOQllkklFHGaSSTwGha7wHuZhwWebRwG2cB7WgZvknAX8DlWf8D8XOc9z3u8xz2tdB2M2NcHnHB6vwe3dp+3ceHwv+ZRw2Q8L/WUcFneKZBdJV3GwZBkGQZBoHAZBoGQd968+7Yhi+JY3NxWrcVq9VY97yvfy3YB6+PensP/jIuK/8Sz8B7HAejwHtcB6c3AZhwGM8B83AenViXA2cB2etY1wHOzWTd93GgZRil3dY7/40zWv/Gz/niHAettFmSelQ563RiHp7KkkkkkkkkkkkliCSSSXF9vNsQ9HyO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'), c => c.charCodeAt(0)));
const COMBINING_MARKS = r.read_member_table();
const IGNORED = r.read_member_table();
const DISALLOWED = r.read_member_table();
const JOIN_T = r.read_member_table();
const JOIN_LD = r.read_member_table();
const JOIN_RD = r.read_member_table();
const VIRAMA = r.read_member_table();
const ZWNJ_EMOJI = r.read_emoji();
const MAPPED = r.read_mapped_table();
r = null;

function lookup_member(table, cp) {
	for (let [x, n] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (d < n) return true;
	}
	return false;
}

function lookup_mapped(cp) {
	for (let [x, y, n, dx, dy] of MAPPED) {
		let d = cp - x;
		if (d < 0) break;
		if (n > 0) {
			if (d < n && d % dx == 0) {
				let r = d / dx;
				return y.map(x => x + r * dy);
			} 
		} else if (d == 0) {
			return y;
		}
	}
}

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

function is_virama(cp) {
	return lookup_member(VIRAMA, cp);
}
function is_combining_mark(cp) {
    return lookup_member(COMBINING_MARKS, cp);
}

// warning: these should not be used directly
// expects code-point (number)
// is_* returns boolean
export function is_disallowed(cp) {
	return lookup_member(DISALLOWED, cp);
}
export function is_ignored(cp) {
	return lookup_member(IGNORED, cp);
}
export function get_mapped(cp) {
	return lookup_mapped(cp)?.slice();
}

export class DisallowedLabelError extends Error {
	constructor(message, label) {
		super(`Disallowed label "${escape_unicode(label)}": ${message}`);
		this.label = label;
	}
}

export class DisallowedCharacterError extends Error {
	constructor(cp, i, desc = '') {
		super(`Disallowed character "${escape_unicode(String.fromCodePoint(cp))}" at position ${1+i}` + (desc ? `: ${desc}` : ''));
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
			throw new DisallowedCharacterError(cp, i);
		}
		if (is_ignored(cp)) return empty;
		if (cp === 0x200C) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && is_virama(v[i - 1])) { 
				return cp; // allowed
			}
			// rule 2: {L,D} + T* + cp + T* + {R,D}
			// L,D,T,R = Joining_Type
			if (i > 0 && i < v.length - 1) { // there is room on either side
				let head = i - 1;
				while (head > 0 && lookup_member(JOIN_T, v[head])) head--; // T*
				if (lookup_member(JOIN_LD, v[head])) { // L or D
					let tail = i + 1;
					while (tail < v.length - 1 && lookup_member(JOIN_T, v[tail])) tail++; // T*
					if (lookup_member(JOIN_RD, v[tail])) { // R or D
						return cp; // allowed
					}
				}
			}
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp, i, `ZWJ outside of context`);
		} else if (cp === 0x200D) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && is_virama(v[i - 1])) { 
				return cp; // allowed
			}
			// custom rule: emoji
			if (is_zwnj_emoji(v, i)) {
				return cp; // allowed
			}
			if (ignore_disallowed) return empty; 
			throw new DisallowedCharacterError(cp, i, `ZWNJ outside of context`);
		}
		return lookup_mapped(cp) ?? cp;
	}).flat()).normalize('NFC');
}

// Primary API
// throws TypeError if not a string
// throws DisallowedLabelError/DisallowedCharacterError if not normalizable
// returns a string ready for namehash
export function ens_normalize(name, ignore_disallowed = false) { // https://unicode.org/reports/tr46/#Processing
	// Processing Rule #1 (Map) via idna()
	// Processing Rule #2 (Normalize) via idna()
	// Processing Rule #3 (Break)
	return idna(name, ignore_disallowed).split('.').map(label => { 
		// Processing Rule #4 (Convert)
		if (label.startsWith('xn--')) {			
			let s = puny_decode(label.slice(4));
			if (s != idna(s, true)) throw new DisallowedLabelError(`puny not idna`, label);
			label = s;
		}
		// Processing Rule #4 (Validate)
		// Section 4.1 Validity Criteria
		// https://unicode.org/reports/tr46/#Validity_Criteria
		// Rule #1 (NFC) via by idna()		
		// Rule #2
		if (/^.{2}--/u.test(label)) throw new DisallowedLabelError(`double-hyphen at position 3`, label);
		// Rule #3
		if (label.startsWith('-')) throw new DisallowedLabelError(`leading hyphen`, label);
		if (label.endsWith('-')) throw new DisallowedLabelError(`trailing hyphen`, label);		
		// Rule #4 (Stop) via idna()
		// Rule #5
		if (label.length > 0 && is_combining_mark(label.codePointAt(0))) throw new DisallowedLabelError(`leading combining mark`, label);
		// Rule #6 (Valid) via idna()
		// Rule #7 (ContextJ) via idna()
		// Rule #8 (Bidi) NYI
		return label;
	}).join('.');
}