export function print_section(s) {
	console.log(`==== ${s} ====`); 
}

export function print_checked(s = 'OK') {
	console.log(`[✓] ${s}`)
}

export function print_table(cols, m, sep = ' | ') {
	let widths = cols.map((_, i) => m.reduce((a, v) => Math.max(a, String(v[i]).length), 0));
	console.log(cols.map((x, i) => {
		let w = widths[i];
		return x.slice(0, w).padEnd(w);
	}).join(sep));
	for (let v of m) {
		console.log(v.map((x, i) => {
			let w = widths[i];
			if (typeof x === 'number') {
				return x.toString().padStart(w);
			} else {
				return x.toString().padEnd(w);
			}
		}).join(sep));
	}
}

export function parse_version(s) {
	let match = s.match(/^(\d+)(\.(\d+)(\.(\d+))?)?$/);
	if (!match) throw new Error('expected version string');
	return {
		major: parseInt(match[1]),
		minor: parseInt(match[3])|0,
		patch: parseInt(match[5])|0,
	};
}

export function version_ordinal(x) {
	if (typeof x !== 'object') {
		x = parse_version(x);
	}
	return x.major + (1 - 1/(1 + x.minor + (1 - 1/(1 + x.patch)))); // use continued fraction expansion
}

// warning: returns single reference since output can be large
// [1,2,3] => [[1,2,3],[2,1,3],[3,1,2],[1,3,2],[2,3,1],[3,2,1]]
// good: for (let v of permutations([1,2,3]))
//  bad: [...permutations([1,2,3])]
export function* permutations(v) {
	let n = v.length;
	if (!n) return;
	v = v.slice();
	yield v;
	if (n == 1) return;
	let u = Array(n).fill(0);
	let i = 1;
	while (i < n) {
		if (u[i] < i) {
			let swap = i&1 ? u[i] : 0;
			let temp = v[swap];
			v[swap] = v[i];
			v[i] = temp;
			yield v;
			u[i]++;
			i = 1;
		} else {
			u[i] = 0;
			i++;
		}
	}
}

export function group_by(iterable, fn) {
	let map = new Map();
	for (let x of iterable) {
		let key = fn(x); 
		let bucket = map.get(key);
		if (!bucket) {
			bucket = [];
			map.set(key, bucket);
		}
		bucket.push(x);
	}
	return map;
}

export const MAX_CP = 0x10FFFF;

export function require_cp(cp) {
	if (!Number.isSafeInteger(cp) || cp < 0 || cp > MAX_CP) {
		throw new TypeError(`expected codepoint: ${cp}`);
	}
	return cp;
}

export function quote_cp(cp) {
	return `{${hex_cp(cp)}}`;
}

export function hex_cp(cp) {
	return cp.toString(16).padStart(2, '0').toUpperCase();
}

export function hex_seq(cps) {
	return `[${cps.map(hex_cp).join(' ')}]`;
}

export function explode_cp(x) {
	if (typeof x === 'string') {
		return [...x].map(c => c.codePointAt(0));
	} else if (Number.isInteger(x)) {
		return [x];
	} else if (Array.isArray(x)) {
		return x;
	} else {
		throw new TypeError('expected codepoint coercible');
	}
}

// hex to dec
export function parse_cp(s) {
	if (/^[0-9a-f]+$/i.test(s)) {
		return require_cp(parseInt(s, 16));
	}
	throw new TypeError(`expected hex codepoint: ${s}`);
}

// "AAAA"      => [0xAAAA]
// "AAAA BBBB" => [0xAAAA, 0xBBBB]
export function parse_cp_sequence(s) {
	return s.split(/\s+/).map(parse_cp);
}

// "AAAA"       => [0xAAAA]
// "AAAA..AAAC" => [0xAAAA, 0xAAAB, 0xAAAC]
export function parse_cp_range(s) {
	let pos = s.indexOf('..');
	if (pos >= 0) {
		let lo = parse_cp(s.slice(0, pos));
		let hi = parse_cp(s.slice(pos + 2));
		if (hi < lo) throw new Error(`expected non-empty range: ${s}`);
		return Array(hi - lo + 1).fill().map((_, i) => lo + i);
	} else {
		return [parse_cp(s)];
	}
}

export function parse_cps(spec) {
	if (Number.isInteger(spec)) {
		return [spec];
	} else if (typeof spec === 'string') {
		return spec.split(/\s+/).map(x => x.trim()).filter(x => x).flatMap(x => parse_cp_range(x));
	}
	throw new TypeError(`unknown character spec: ${spec}`);
}

export function compare_arrays(a, b) {
	let n = a.length;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

// https://stackoverflow.com/a/47593316 is bugged, seed (a) doesn't wrap
// https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
export function mulberry32(a) {
	return () => {
		let t = a = a + 0x6D2B79F5|0;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
	};
}

export function bytes_from_utf8(s) {
	if (typeof s !== 'string') throw new TypeError('expected string');
	let v = [];
	for (let pos = 0, len = s.length; pos < len; ) {
		let cp = s.codePointAt(pos++);
		if (cp < 0x800) {
			if (cp < 0x80) {
				v.push(cp);
			} else {
				v.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
			}
		} else {
			if (cp < 0x10000) {
				v.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
			} else {
				v.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
				pos++;
			}
		}
	}
	return Uint8Array.from(v);
}