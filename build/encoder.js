import {} from './utils.js'; // Array.prototype, fix me?

export function split_linear(mapped, dx, dy) {
	let linear = [];
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

export class Encoder {
	constructor() {
		this.buf = [];
	}
	compressed() {
		let bits = [];
		let prev = 0;
		let {buf} = this;
		let {length} = buf;
		for (let i = 0; i < length; i++) {
			let next = buf[i];
			let delta = next - prev;
			if (delta == 0) {
				let end = i + 1;
				while (delta == 0 && end < length && buf[end] == next) end++;
				bits.push(0, ...huffman(end - i - 1));
				i = end - 1;
				continue;
			} else if (delta > 0) {
				bits.push(1, 0, ...huffman(delta - 1));
			} else {
				bits.push(1, 1, ...huffman(~delta));
			}
		}
		while (bits.length & 7) bits.push(1);
		return bytes_from_bits(bits);
	}
	unsigned(i) { this.buf.push(...huffman(i)); }
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
		let m = v.split((a, b) => b - a == 1);
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
		emoji = Object.values(emoji.group_by(v => [v.length, ...v.indices_of(ZWNJ)].join(':')));
		// transpose and remove ZWNJ
		this.unsigned(emoji.length);
		for (let m of emoji) {
			// m = [A Z B Z C] => Tr(m) = [A A]
			//     [A Z B Z D]    w/o     [B B]
			// pos = [1,  3]      ZWNJ    [C D]
			let [first] = m;
			let zwnj = first.indices_of(ZWNJ);
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

// compress a list of bytes
export function encode2(v) {
	const A = 2;
	const B = 4;
	let ret = [];
	for (let x of v) {
		let w = bit_width(x);
		if (w <= A) {
			ret.push(0, ...bit_array(x, A));
		} else if (w <= B) {
			ret.push(1, 0, ...bit_array(x, B));
		} else {
			ret.push(1, 1, ...bit_array(x, 8));
		}
	}
	while (ret.length & 7) ret.push(1);
	return bytes_from_bits(ret);
}

export function bit_width(i) {
	return 32 - Math.clz32(i);
}

// compress speed is irrelevant so
// doesn't matter if this is pepega
export function bit_array(i, n) {
	let v = Array(n);
	while (n > 0) {
		v[--n] = i & 1;
		i >>= 1;
	}
	return v;
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