// compress a list of bytes
export function encode2(v) {
	let ret = [];
	for (let x of v) {
		let w = bit_width(x);
		if (w <= 2) {
			ret.push(0, ...bit_array(x, 2));
		} else if (w <= 4) {
			ret.push(1, 0, ...bit_array(x, 4));
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