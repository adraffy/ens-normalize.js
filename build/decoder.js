export function arithmetic_decoding(bytes) {
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
		let b = low + Math.floor(range * acc[start+1] / total) - 1
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
	/*
	let offset = symbol_count - 3;
	return symbols.map(x => { // index into payload
		switch (x - offset) {
			case 2: return offset + 0x10000 + ((bytes[pos_payload++] << 16) | (bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 1: return offset + ((bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			default: return x - 1;
		}
	});*/
}

export class Decoder {
	constructor(values) {
		this.pos = 0;
		this.values = values;
	}
	read() { 
		return this.values[this.pos++];
	}
	read_signed() { // eg. [0,1,2,3...] => [0,-1,1,-2,...]
		let i = this.read();		
		return (i & 1) ? (~i >> 1) : (i >> 1);
	}
	read_counts(n) {
		let v = Array(n);
		for (let i = 0; i < n; i++) v[i] = 1 + this.read();
		return v;
	}
	read_ascending(n) {
		let v = Array(n);
		for (let i = 0, x = -1; i < n; i++) v[i] = x += 1 + this.read();
		return v;
	}
	read_deltas(n) {
		let v = Array(n);
		for (let i = 0, x = 0; i < n; i++) v[i] = x += this.read_signed();
		return v;
	}
	read_member_tables(n) {
		let ret = [];
		for (let i =0; i < n; i++) {
			ret.push(this.read_member_table());
		}
		return ret;
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
		while (true) {
			let w = this.read();
			if (w == 0) break;
			ret.push(this.read_linear_table(w));
		}
		while (true) {
			let w = this.read() - 1;
			if (w < 0) break;
			ret.push(this.read_mapped_replacement(w));
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
		let n = 1 + this.read();
		let vX = this.read_ascending(n);
		let mY = this.read_ys_transposed(n, w);
		return vX.map((x, i) => [x, mY.map(v => v[i])])
	}
	read_linear_table(w) {
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
		for (let k = this.read(); k > 0; k--) {
			let n = 1 + this.read(); // group size
			let w = 1 + this.read(); // group width w/o ZWNJ
			let p = 1 + this.read(); // bit positions of zwnj
			let z = []; // position of zwnj
			let m = []; // emoji vectors
			for (let i = 0; i < n; i++) m.push([]);
			for (let i = 0; i < w; i++) {
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

export function lookup_member(table, cp) {
	for (let [x, n] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (d < n) return true;
	}
	return false;
}

export function lookup_mapped(table, cp) {
	for (let [x, ys, n, dx, dy] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (n > 0) {
			if (d < dx * n && d % dx == 0) {
				let r = d / dx;
				return ys.map(y => y + r * dy);
			} 
		} else if (d == 0) {
			return ys;
		}
	}
}
