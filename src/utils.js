
export function hex_cp(cp) {
	return cp.toString(16).toUpperCase();
}

export function quote_cp(cp) {
	return `{${hex_cp(cp)}}`;
}

export function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

export function filter_fe0f(cps) {
	return cps.filter(cp => cp != 0xFE0F);
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

export function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}