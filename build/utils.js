export function random_bytes(n) {	
	let v = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		v[i] = (Math.random() * 256)|0; 
	}
	return v;
}

export function compare_array(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

// keep compressing a list of bytes until the compressor fails
export function recursive_encoder(fn, best, max = Infinity) {
	let n = 0;
	for (; best.length > 0 && n < max; n++) {
		let v = fn(best);
		if (v.length > best.length) break;
		best = v;
	}
	return {v: best, n}
}

export function escape_unicode(s) {
	return s.replace(/[^\.\-a-z0-9]/igu, x => `{${x.codePointAt(0).toString(16).toUpperCase()}}`);
}

// parse range of hex cps
// "AAAA"       => [0xAAAA]
// "AAAA..BBBB" => [0xAAAA, ..., 0xBBBB]
export function cps_from_range(s) {
	let [lo, hi] = s.split('..');
	lo = parseInt(lo, 16);
	if (!Number.isSafeInteger(lo) || lo < 0) throw new TypeError('expected code point');
	if (!hi) return [lo];
	hi = parseInt(hi, 16);
	if (!Number.isSafeInteger(hi) || hi < lo) throw new TypeError('expected upper code point');
	return Array(hi - lo + 1).fill().map((_, i) => lo + i);
}

// parse sequence of hex cps
// "AAAA BBBB CCCC" => [0xAAAA, 0xBBBB, 0xCCCC]
export function cps_from_sequence(s) {
	return s.split(/\s+/).map(x => parseInt(x, 16));
}


// return all indicies of exact match in array
// [1, 2, 1, 1] of 1 => [0, 2, 3]
export function indices_of(v, x) {
	let ret = [];
	let last = 0;
	while (true) {
		let i = v.indexOf(x, last);
		if (i == -1) break;
		ret.push(i);
		last = i + 1;
	}
	return ret;
}

// group list into collection
// [1, 2, 2, 3] + odd => [odd:[1,3], even:[2,2]]
export function group_by(v, fn, gs = {}) {
	for (let x of v) {
		let key = fn(x);
		let g = gs[key];
		if (!g) g = gs[key] = [];
		g.push(x);
	}
	return gs;
}

// split list into runs where 
// [..., a, b, ...] => [[..., a], [b, ...]] if fn(a, b)
export function split_between(v, fn) {
	let start = 0;
	let groups = [];
	for (let i = 1; i < v.length; i++) {
		if (fn(v[i - 1], v[i])) {
			groups.push(v.slice(start, i));
			start = i;
		}
	}
	if (start < v.length) {
		groups.push(v.slice(start));
	}
	return groups;
}

// split an array on specific values
// [a, b, x, c, d] => [[a, b], [c, d]]
export function split_on(v, x) {
	let ret = [];
	let pos = 0;
	while (true) {
		let next = v.indexOf(x, pos);
		if (next == -1) break;
		ret.push(v.slice(pos, next));
		pos = next + 1;		
	}
	ret.push(v.slice(pos));
	return ret;
}