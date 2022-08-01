
export function hex_cp(cp) {
	return cp.toString(16).toUpperCase();
}

export function quote_cp(cp) {
	return `{${hex_cp(cp)}}`;
}

export function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

export function escape_for_html(s, quoter = quote_cp) {
	// printable w/o:
	// html: 0x26 &, 0x3C <, 0x3E >
	// quote: 0x00-0x20 control, 0x7F DEL, whitespace, joiners, tagspec
	return s.replace(/(?:([\x00-\x20\x7F\xA0\s\u200C\u200D\u{E0020}-\u{E007F}])|([^\x21-\x25\x27-\x3B\x3D\x3F-\x7E]))/gu, 
		(_, a, b) => a ? quoter(a.codePointAt(0)) : `&#${b.codePointAt(0)}`);
}

export function escape_unicode(s) {
	// printable w/o:
	// 0x20 (space)
	// 0x22 (double-quote)
	// 0x7B/0x7D (curly-brace, used for escaping)
	// 0x7F (delete)
	return s.replace(/[^\x21\x23-\x7A\x7C\x7E]/gu, x => quote_cp(x.codePointAt(0)));
}

export function is_printable_ascii(s) {	
	// printable w/o:
	// 0x20 (space)
	// 0x7F (delete)
	return /^[\x21-\x7E]+$/gu.test(s);
}


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

export function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}