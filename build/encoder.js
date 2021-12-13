import {group_by, indices_of, split_between} from './utils.js'; // Array.prototype, fix me?

export function split_linear(mapped, dx, dy) {
	let linear = [];
	mapped = mapped.map(v => v.slice());
	for (let i = 0; i < mapped.length; i++) {
		let row0 = mapped[i];
		let [x0, ys0] = row0;
		if (x0 == -1) continue; // marked
		let group = [row0];
		next: for (let j = i + 1; j < mapped.length; j++) {
			let row =  mapped[j];
			let [x, ys] = row;
			if (x == -1) continue; // marked
			let x1 = x0 + group.length * dx;
			if (x < x1) continue;
			if (x > x1) break;
			for (let k = 0; k < ys0.length; k++) {
				if (ys0[k] + group.length * dy != ys[k]) continue next;
			}
			group.push(row);
		}
		if (group.length > 1) {
			group.forEach(v => v[0] = -1); // mark used
			linear.push([x0, group.length, ys0]);
		}
	}
	return {linear, nonlinear: mapped.filter(v => v[0] >= 0)}; // remove marked
}

export function huffman(i) {
	if (i < 0x80) {
		if (i < 0) throw new RangeError(`huffman underflow`);
		return [i];
	}
	i -= 0x80;
	if (i < 0x7F00) {
		return [0x80 | (i >> 8), i & 0xFF];
	}
	i -= 0x7F00;
	let upper = i >> 16;
	if (upper > 255) throw new RangeError('huffman overflow');
	return [255, upper, (i >> 8) & 0xFF, i & 0xFF];
}

export function bytes_from_bits(v) {
	if (v.length & 7) throw new TypeError('not divisible by 8');
	let ret = [];
	for (let i = 0; i < v.length; ) {
		let b = 0;
		for (let j = 7; j >= 0; j--) {
			b |= v[i++] << j;
		}
		ret.push(b);
	}
	return ret;
}

export function best_arithmetic_encoding(symbols, max = 64) {
	let best;
	for (let n = 0; n <= max; n++) {
		let v = arithmetic_encoding(symbols, n);
		if (!best || v.length < best.length) {
			best = v;
		}
	}
	return best;
}

// TODO: make this adaptive
// TODO: make payload symbols encoded as bit-width symbols
// eg. instead of byte[1,2,3] use bits[5-20]
// this goes from 11.5KB to 8KB see: CheckLogarithmic.nb
export function arithmetic_encoding(symbols, linear) {	
	if (symbols.length == 0) throw new Error(`no symbols`);
	if (linear < 0) throw new Error(`should be non-negative`);
	let bytes = [];
	symbols = symbols.map(x => {
		if (x >= linear) {
			x -= linear;
			if (x < 0x100) {
				bytes.push(x);
				return linear + 1;
			}
			x -= 0x100;
			if (x < 0x10000) {
				bytes.push(x >> 8, x & 0xFF);
				return linear + 2;
			}
			x -= 0x10000;
			bytes.push(x >> 16, (x >> 8) & 0xFF, x & 0xFF);
			return linear + 3;
		} else {
			return x + 1;
		}
	});
	/*
	symbols = symbols.map(x => {
		if (x >= linear) {
			x -= linear;
			if (x < 0x10000) {
				bytes.push(x >> 8, x & 0xFF);
				return linear + 1;
			}
			x -= 0x10000;
			bytes.push(x >> 16, (x >> 8) & 0xFF, x & 0xFF);
			return linear + 2;
		} else {
			return x + 1;
		}
	});
	*/
	symbols.push(0);
	// create frequency table
	let freq = Array(linear + 4).fill(0);
	//let freq = Array(linear + 3).fill(0);
	for (let x of symbols) freq[x]++;
	freq = freq.map(x => Math.max(1, x)); // prevent sparse
	// create accumulated table
	let acc = [0];
	let total = 0;
	for (let i = 0; i < freq.length; i++) {
		acc.push(total += freq[i]);
	}

	const N = 31;
	const FULL = 2**N;
	const HALF = FULL >>> 1;
	const QRTR = HALF >> 1;
	const MASK = FULL - 1;

	let low = 0;
	let range = FULL;
	let underflow = 0;
	let bits = [];
	for (let x of symbols) {
		let a = low + Math.floor(range * acc[x]   / total);
		let b = low + Math.floor(range * acc[x+1] / total) - 1;
		while (((a ^ b) & HALF) == 0) {
			let bit = a >>> (N - 1);
			bits.push(bit);
			for (; underflow > 0; underflow--) bits.push(bit ^ 1);
			a = (a << 1) & MASK;
			b = (b << 1) & MASK | 1;
		}
		while (a & ~b & QRTR) {
			underflow++;
			a = (a << 1) ^ HALF;
			b = ((b ^ HALF) << 1) | HALF | 1;
		}
		low = a;
		range = 1 + b - a;
	}
	bits.push(1);
	while (bits.length & 7) bits.push(0);
	let header = [];
	freq[0] = freq.length;
	freq.push(bytes.length);
	for (let n of freq) {
		header.push(n >> 8, n & 0xFF);
	}
	return header.concat(bytes, bytes_from_bits(bits));
}

export class Encoder {
	constructor() { 
		this.values = [];
	}
	compressed() {
		return this.compress_arithmetic();
	}
	compress_arithmetic() {
		return best_arithmetic_encoding(this.values);
	}
	compress_huffman() {
		return this.values.flatMap(huffman);
	}
	unsigned(x) { this.values.push(x); }
	signed(i) { this.unsigned(i < 0 ? -1 - 2 * i : 2 * i); }
	positive(i) { this.unsigned(i - 1); }
	counts(v) { for (let x of v) this.positive(x); }
	ascending(v) {
		let prev = 0;
		for (let x of v) {
			this.unsigned(x - prev);
			prev = x + 1;
		}
	}
	deltas(v) {
		let prev = 0;
		for (let x of v) {
			this.signed(x - prev);
			prev = x;
		}
	}
	write_member(v) {
		let m = split_between(v, (a, b) => b - a > 1);
		let g1 = m.filter(g => g.length == 1);
		let gN = m.filter(g => g.length != 1);
		this.unsigned(g1.length);
		this.ascending(g1.map(g => g[0]));
		this.unsigned(gN.length);
		this.ascending(gN.map(g => g[0]));
		this.counts(gN.map(g => g.length));
	}
	write_transposed_ys(w, m) {
		this.deltas(m.map(v => v[0]));
		for (let j = 1; j < w; j++) {
			for (let i = 0; i < m.length; i++) {
				let v = m[i];
				this.signed(v[j] - v[j-1]);
			}
		}
	}
	write_mapped(linear_specs, mapped) {
		mapped = mapped.slice(); // mutated
		for (let [w, dx, dy] of linear_specs) {
			if (w >= mapped.length) throw new Error(`linear spec out of bounds: ${w}`);
			let {linear, nonlinear} = split_linear(mapped[w], dx, dy);
			/*
			console.log(`Linear ${w}: ${dx} ${dy} = ${linear.length}`)
			if (linear.length === 0) continue;
			*/
			if (linear.length === 0) throw new Error(`empty linear spec: ${w} ${dx} ${dy}`);
			mapped[w] = nonlinear; // remove them
			this.unsigned(w);
			this.positive(dx);
			this.unsigned(dy);
			this.positive(linear.length);
			this.ascending(linear.map(v => v[0])); 
			this.counts(linear.map(v => v[1]));
			this.write_transposed_ys(w, linear.map(v => v[2]));
		}
		this.unsigned(0); // eol
		mapped.forEach((m, w) => {
			if (m.length == 0) return;
			this.unsigned(1 + w);
			this.positive(m.length);
			this.ascending(m.map(v => v[0]));
			this.write_transposed_ys(w, m.map(v => v[1]));
		});
		this.unsigned(0); // eol
	}
	write_emoji(emoji) {
		const ZWNJ = 0x200D;
		emoji = emoji.map(v => v.filter(x => x != 0xFE0F));
		// group by (width and position of ZWNJ)
		emoji = Object.values(group_by(emoji, v => [v.length, ...indices_of(v, ZWNJ)].join(':')));
		// transpose and remove ZWNJ
		this.unsigned(emoji.length);
		for (let m of emoji) {
			// m = [A Z B Z C] => Tr(m) = [A A]
			//     [A Z B Z D]    w/o     [B B]
			// pos = [1,  3]      ZWNJ    [C D]
			let [first] = m;
			let zwnj = indices_of(first, ZWNJ);
			this.positive(m.length); // number of elements
			this.positive(first.length - zwnj.length); // width w/o ZWNJ
			this.positive(zwnj.reduce((a, i) => a | (1 << (i - 1)), 0)); // bit positions of ZWNJ
			for (let i = 0; i < first.length; i++) {
				if (zwnj.indexOf(i) >= 0) continue;
				this.deltas(m.map(v => v[i]));
			}
		}
	}
}