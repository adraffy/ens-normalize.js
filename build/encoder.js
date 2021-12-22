import {group_by, indices_of, split_between, split_linear, tally, split_on} from './utils.js'; 

export function is_better_member_compression(smaller, bigger) {
	let s = new Encoder();
	for (let x of smaller) s.write_member(x);
	let b = new Encoder();
	for (let x of bigger) b.write_member(x);
	let ns = s.compress_arithmetic().length;
	let nb = b.compress_arithmetic().length;
	return ns < nb;
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

export function best_arithmetic(symbols, max = 64) {
	let best;
	for (let n = 0; n <= max; n++) {
		let v = encode_arithmetic(symbols, n);
		if (!best || v.length < best.length) {
			best = v;
		}
	}
	return best;
}

export function bit_width(i) {
	return 32 - Math.clz32(i);
}

// TODO: make this adaptive
// TODO: make payload symbols encoded as bit-width symbols
// eg. instead of byte[1,2,3] use bits[5-20]
// this goes from 11.5KB to 8KB see: CheckLogarithmic.nb
// 00001        0001
// 10000 => w=5 0000 
export function encode_arithmetic(symbols, linear) {	
	if (symbols.length == 0) throw new Error(`no symbols`);
	if (linear < 0) throw new Error(`should be non-negative`);
	let payload = [];
	let w0 = bit_width(linear);
	symbols = symbols.map(x => {
		if (x >= linear) {
			x -= linear;			
			if (x < 0x100) {
				payload.push(x);
				return linear + 1;
			}
			x -= 0x100;
			if (x < 0x10000) {
				payload.push(x >> 8, x & 0xFF);
				return linear + 2;
			}
			x -= 0x10000;
			payload.push(x >> 16, (x >> 8) & 0xFF, x & 0xFF);
			return linear + 3;
		} else {
			return x + 1;
		}
	});
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
	freq.push(payload.length);
	for (let n of freq) {
		header.push(n >> 8, n & 0xFF);
	}
	return header.concat(payload, bytes_from_bits(bits));
}

export class Encoder {
	constructor() { 
		this.values = [];
	}
	compressed() {
		return this.compress_arithmetic();
	}
	compress_arithmetic() {
		return best_arithmetic(this.values);
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
	/*
	write_emoji_chunks1(emojis, sep) {
		let chunks = tally(emojis.flatMap(u => split_on(u, sep).map(v => v.join())));
		chunks = Object.entries(chunks).sort((a, b) => b[1] - a[1]);
		for (let [key] of chunks) {
			let cps = key.split(',').map(x => parseInt(x));
			this.unsigned(cps.length);
			cps.forEach(cp => this.unsigned(cp));
		}
		
		this.unsigned(0);
		let map = Object.fromEntries(chunks.map(([key], i) => [key, i]));		
		for (let cps of emojis) {
			let chunks = split_on(cps, sep);
			this.unsigned(chunks.length); // number of chunks
			for (let v of chunks) {
				this.unsigned(map[v.join()]); // index into the chunks
			}
		}
		this.unsigned(0);
	}
	write_emoji_chunks2(emojis) {
		let unique = [...new Set(emojis.flat())].sort((a, b) => a - b);
		console.log(unique);
		console.log(unique.length);
		this.ascending(unique);
		for (let cps of emojis) {
			//this.unsigned(cps.length);
			for (let cp of cps) {
				this.unsigned(unique.indexOf(cp)); 
			}
		}
		this.unsigned(0);
	}
	*/
	write_emoji(emoji, sep) {
		// group by (width and position of sep)
		emoji = Object.values(group_by(emoji, v => [v.length, ...indices_of(v, sep)].join(':')));
		// transpose and remove sep
		this.unsigned(emoji.length);
		for (let m of emoji) {
			// m = [A Z B Z C] => Tr(m) = [A A]
			//     [A Z B Z D]    w/o     [B B]
			// pos = [1,  3]      sep     [C D]
			let [first] = m;
			let where = indices_of(first, sep);
			this.positive(m.length); // number of elements
			this.positive(first.length - where.length); // width w/o sep
			this.positive(where.reduce((a, i) => a | (1 << (i - 1)), 0)); // bit positions of sep
			for (let i = 0; i < first.length; i++) {
				if (where.indexOf(i) >= 0) continue;
				this.deltas(m.map(v => v[i]));
			}
		}
	}

}