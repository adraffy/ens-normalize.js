export function random_bytes(n) {	
	let v = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		v[i] = (Math.random() * 256)|0; 
	}
	return v;
}

export function base64_from_bytes(v) {
	return btoa(String.fromCharCode(...v));
}

export function compare_array(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

export function bit_width(i) {
	return 32 - Math.clz32(i);
}

export function tally(v) {
	let t = [];
	for (let x of v) t[x] = (t[x] ?? 0) + 1;
	for (let i = 0; i < t.length; i++) t[i] |= 0;
	return t;
}

export function delta(v) {
	let ret = [];
	let prev = 0;
	for (let x of v) {
		ret.push(x - prev);
		prev = x;
	}
	return ret;
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
