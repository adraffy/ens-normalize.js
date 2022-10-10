export function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

export function quote_cp(cp) {
	return `{${hex_cp(cp)}}`; // my convention: like "\u{X}" w/o the "\u"
}

/*
export function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}
*/
export function explode_cp(s) { // this is about 2x faster
	let cps = [];
	for (let pos = 0, len = s.length; pos < len; ) {
		let cp = s.codePointAt(pos);
		pos += cp < 0x10000 ? 1 : 2;
		cps.push(cp);
	}
	return cps;
}

export function str_from_cps(cps) {
	return String.fromCodePoint(...cps);
}

export function escape_for_html(s, quoter = quote_cp) {
	// invis: 0x00-0x20 control, 0x7F DEL, whitespace, joiners, tagspec
	//  html: 0x26 &, 0x3C <, 0x3E >
	return s.replace(/(?:([\x00-\x20\x7F-\xA0\s\u200C\u200D\u2800\u{E0020}-\u{E007F}])|([\x26\x3C\x3E]))/gu, 
		(_, a, b) => a ? quoter(a.codePointAt(0)) : `&#${b.codePointAt(0)};`);
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

export function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

export function random_choice(v, rng = Math.random) {
	return v[rng() * v.length|0];
}

export function random_sample(v, n, rng = Math.random) {
	v = v.slice(); // make copy
	if (v.length > n) {
		for (let i = 0; i < n; i++) { // shuffle prefix n
			let temp = v[i]; 
			let j = Math.floor(i + rng() * (v.length - i));
			v[i] = v[j];
			v[j] = temp;
		}
		v = v.slice(0, n); // truncate
	}
	return v;
}

export function run_tests(fn, tests) {
	let errors = [];
	for (let test of tests) {
		let {name, norm, error} = test;
		if (typeof norm !== 'string') norm = name;
		try {
			let result = fn(name);
			if (error) {	
				errors.push({type: 'expected error', result, ...test});
			} else if (result != norm) {
				errors.push({type: 'wrong norm', result, ...test});
			}
		} catch (err) {
			if (!error) {
				errors.push({type: 'unexpected error', result: err.message, ...test});
			}
		}
	}
	return errors;
}
