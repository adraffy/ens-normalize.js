export function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

export function quote_cp(cp) {
	return `{${hex_cp(cp)}}`; // raffy convention: like "\u{X}" w/o the "\u"
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
	const chunk = 4096;
	let len = cps.length;
	if (len < chunk) return String.fromCodePoint(...cps);
	let buf = [];
	for (let i = 0; i < len; ) {
		buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
	}
	return buf.join('');
}

export function compare_arrays(a, b) {
	let n = a.length;
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
