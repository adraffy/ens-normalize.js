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

// ************************************************************
// array helpers

// split list into runs where 
// [..., a, b, ...] => [[..., a], [b, ...]] unless fn(a, b)
Array.prototype.split = function(fn) {
	let start = 0;
	let groups = [];
	for (let i = 1; i < this.length; i++) {
		if (!fn(this[i - 1], this[i])) {
			groups.push(this.slice(start, i));
			start = i;
		}
	}
	if (start < this.length) {
		groups.push(this.slice(start));
	}
	return groups;
}

// collect into groups by key
Array.prototype.group_by = function(fn, groups = {}) {
	for (let x of this) {
		let key = fn(x);
		let group = groups[key];
		if (!group) group = groups[key] = [];
		group.push(x);
	}
	return groups;
}

// sort by plucked key difference
// check for duplicates
Array.prototype.union = function(pluck = x => x) {
	let sorted = this.slice().sort((a, b) => pluck(a) - pluck(b));
	
	return sorted;
}

// differences
// [a, b, c, ...] => [a, b-a, c-b, ...]
Array.prototype.delta = function() {
	let {length} = this;
	let v = Array(length);
	let a = 0;
	for (let i = 0; i < length; i++) {
		let x = this[i];
		v[i] = x - a;
		a = x;
	}
	return v;
}

// return indicies of x in
// [1, a, 1, b, 1].indices_of(1) = [0, 2, 4]
Array.prototype.indices_of = function(x) {
	let v = [];
	let last = 0;
	while (true) {
		let i = this.indexOf(x, last);
		if (i == -1) break;
		v.push(i);
		last = i + 1;
	}
	return v;
}

// return counts of elements
Array.prototype.tally = function(t = {}) {
	for (let x of this) t[x] = (t[x] ?? 0) + 1;
	if (Array.isArray(t)) for (let i = 0; i < t.length; i++) t[i] |= 0; // fill zeros
	return t;
}