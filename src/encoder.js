import {compare_arrays} from './utils.js'; 

// group list into collection
// [1, 2, 2, 3] + odd => [odd:[1,3], even:[2,2]]
export function group_by(v, fn, ret = {}) {
	for (let x of v) {
		let key = fn(x);
		let g = ret[key];
		if (!g) g = ret[key] = [];
		g.push(x);
	}
	return ret;
}

// split list into runs where 
// [..., a, b, ...] => [[..., a], [b, ...]] if fn(a, b)
export function split_between(v, fn) {
	let start = 0;
	let ret = [];
	for (let i = 1; i < v.length; i++) {
		if (fn(v[i - 1], v[i])) {
			ret.push(v.slice(start, i));
			start = i;
		}
	}
	if (start < v.length) {
		ret.push(v.slice(start));
	}
	return ret;
}

// from a list of [[x,ys]...]
// find spans of [[x,ys],[x+dx,ys+dy],[x+2dx,ys+2dy],...]
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

// group 8 bits into 1 byte
// [0, 1, 1, 0, ...] => [0b0110..., ...]
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

// vary symbol count to find best encoding 
export function best_arithmetic(symbols, max = 128) { 
	let best;
	for (let n = 0; n <= max; n++) {
		let v = encode_arithmetic(symbols, n);
		if (!best || v.length < best.data.length) {
			best = {data: v, symbols: n};
		}
	}
	return best;
}

export const MAX_LINEAR = 251;

// TODO: make this adaptive
// TODO: make payload symbols encoded as bit-width symbols
// eg. instead of byte[1,2,3] use bits[5-20]
// this goes from 11.5KB to 8KB see: CheckLogarithmic.nb
// 00001        0001
// 10000 => w=5 0000 
export function encode_arithmetic(symbols, linear) {	
	if (symbols.length == 0) throw new Error(`no symbols`);
	if (linear < 0) throw new Error(`linear symbols must be non-negative`);
	if (linear > MAX_LINEAR) throw new Error(`too many linear symbols`);
	let payload = [];
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
	symbols.push(0); // END
	// create frequency table
	let freq = Array(linear + 4).fill(0); // END + 1,2,3-byte symbols
	if (freq.length > 255) throw new Error(`bug`);
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

export function unsafe_btoa(v) {
	return Buffer.from(v).toString('base64').replace(/=+$/, '');
}

export class Encoder {
	constructor() { 
		this.values = [];
	}
	compressed() {
		return best_arithmetic(this.values);
	}
	unsigned(x) { 
		if (!Number.isSafeInteger(x) || x < 0) throw new TypeError(`expected unsigned: ${x}`);
		this.values.push(x); 
	}
	signed(i) { this.unsigned(i < 0 ? ~(i << 1) : (i << 1)); }
	positive(i) { this.unsigned(i - 1); }
	positive_counts(v) { for (let x of v) this.positive(x); }
	array(v) {
		for (let x of v) {
			this.unsigned(x);
		}
	}
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
		if (v instanceof Set) {
			v = [...v];
		} else if (Array.isArray(v)) {
			v = [...new Set(v)];
		} else {
			throw new TypeError('expected set or array');
		}
		if (v.some(x => !Number.isSafeInteger(x) || x < 0)) {
			throw new TypeError('expected unsigned');
		}
		let prev = 0;
		for (let run of split_between(v.sort((a, b) => a - b), (a, b) => b - a > 1)) {
			this.unsigned(run[0] - prev);
			this.unsigned(run.length);
			prev = run[run.length-1] + 2;
		}
		this.unsigned(0);
		this.unsigned(0);
	}
	/*
	write_member(v) {
		return this.write_member2(v);
	}
	write_member1(v) {
		if (v instanceof Set) {
			v = [...v];
		} else if (Array.isArray(v)) {
			v = [...new Set(v)];
		} else {
			throw new TypeError('expected set or array');
		}
		if (v.some(x => !Number.isSafeInteger(x) || x < 0)) {
			throw new TypeError('expected unsigned');
		}
		v = v.sort((a, b) => a - b);
		let m = split_between(v, (a, b) => b - a > 1);
		let g1 = m.filter(g => g.length == 1);
		let gN = m.filter(g => g.length != 1);
		this.unsigned(g1.length);
		this.ascending(g1.map(g => g[0]));
		this.unsigned(gN.length);
		this.ascending(gN.map(g => g[0]));
		this.positive_counts(gN.map(g => g.length));
	}
	*/
	write_transposed(m) {
		if (m.length == 0) return;
		let w = m[0].length;
		for (let i = 0; i < w; i++) {
			this.deltas(m.map(v => v[i]));
		}
	}
	write_mapped(linear_specs, mapped) {
		mapped = group_by(mapped, ([_, ys]) => ys.length, []).map(v => v.sort((a, b) => a[0] - b[0]));
		for (let [w, dx, dy] of linear_specs) {
			if (!(dx > 0)) throw new TypeError(`expected positive dx: ${dx}`);
			if (w >= mapped.length) {				
				console.log(`linear spec not used: out of bounds: ${w}`);
				continue;
			}
			let {linear, nonlinear} = split_linear(mapped[w], dx, dy);
			if (linear.length == 0) {
				console.log(`linear spec not used: empty: ${w} ${dx} ${dy}`);
				continue;
			}
			//console.log({w, dx, dy, n: linear.length})
			mapped[w] = nonlinear; // remove them
			this.unsigned(w);
			this.positive(dx);
			this.unsigned(dy);
			linear.forEach(v => this.unsigned(v[1]));
			this.unsigned(0);
			this.write_transposed(linear.map(([x, _, ys]) => [x, ...ys]).sort(compare_arrays));
		}
		this.unsigned(0); // eol
		mapped.forEach((m, w) => {
			if (m.length == 0) return;
			this.unsigned(1 + w);
			this.positive(m.length);
			this.write_transposed(m.map(([x, ys]) => [x, ...ys]).sort(compare_arrays));
		});
		this.unsigned(0); // eol
	}

}