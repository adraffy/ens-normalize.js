export class Decoder {
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
