
export function parse_version(s) {
	let match = s.match(/^(\d+)(\.(\d+)(\.(\d+))?)?$/);
	if (!match) throw new Error('expected version string');
	return {
		major: parseInt(match[1]),
		minor: parseInt(match[3])|0,
		patch: parseInt(match[5])|0,
	};
}

export function version_ordinal(x, base = 100) {
	if (typeof x !== 'object') {
		x = parse_version(x);
	} 
	return x.major*base*base + x.minor*base + x.patch;
}

export function hex_cp(cp) {
	return cp.toString(16).padStart(2, '0').toUpperCase();
}

export function hex_seq(cps) {
	return `[${cps.map(hex_cp).join(' ')}]`;
}

// str to cps
export function explode_cp(s) {
	if (typeof s != 'string') throw new TypeError(`expected string`);	
	return [...s].map(c => c.codePointAt(0));
}

// hex to dec
export function parse_cp(s) {
	if (/^[0-9a-f]+$/i.test(s)) {
		let cp = parseInt(s, 16);
		if (Number.isSafeInteger(cp) && cp >= 0) {
			return cp;
		}
	}
	throw new TypeError(`expected code point: ${s}`);
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

export function compare_arrays(a, b) {
	let n = a.length;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}
