
import {puny_encode} from 'https://unpkg.com/@adraffy/punycode@0.0.1/dist/index.min.js';

// ************************************************************

// https://en.wikipedia.org/wiki/Domain_Name_System
// https://chromium.googlesource.com/chromium/src/+/main/docs/idn.md

// lower-ascii DNS characters valid in IDNA 2003
const VALID = new Set(explode_cp('-.0123456789abcdefghijklmnopqrstuvwxyz'));

// [len, 63][len, 63][len, 63][len, 61][len, 0] = 255 
// 63+1+63+1+63+1+61 = 253
const MAX_NAME = 253; 
const MAX_LABEL = 63;

function label_error(label, message) {
	return new Error(`Invalid label "${escape_unicode(label)}": ${message}`);
}

// assume: name is from ens_normalize()
export function dns_from_normalized_ens(name) {	
	let acc = 0;
	return name.split('.').map((label, i) => {
		if (i > 0) acc++; // separator
		if (!label) return ''; // empty label
		let cps = explode_cp(label);
		let encoded = puny_encode(cps);
		if (encoded.length > MAX_LABEL) throw label_error(label, `too long`);
		for (let cp of encoded) {
			if (!VALID.has(cp)) {
				throw label_error(label, `invalid ASCII: "${escape_unicode(String.fromCodePoint(cp))}"`);
			}
		}
		acc += encoded.length;
		if (encoded === cps) {
			if (label.slice(2, 4) === '--') throw label_error(label, 'invalid label extension');
			if (label.startsWith('-')) throw label_error(label, 'leading hyphen');
			if (label.endsWith('-')) throw label_error(label, 'trailing hyphen');
		} else {
			acc += 4;
			label = 'xn--' + String.fromCodePoint(...encoded);
		}
		if (acc > MAX_NAME) throw new Error(`Name too long`);
		return label;
	}).join('.');
}


function str(...v) {
	return escape_name_for_html(String.fromCodePoint(...v), cp => {
		if (cp == 0x200C) {
			return '<span class="mod zwj">ZWNJ</span>';
		} else if (cp == 0x200D) {
			return '<span class="mod zwj">ZWJ</span>';
		} else {
			return `<code>${hex_cp(cp)}</code>`;
		}
	});
}

function tooltip(cps) {
	return `Hex: 0x${cps.map(hex_cp).join(' ')}\nDec: ${cps.join(' ')}`;
}

export function dom_from_tokens(tokens, show_mapped = true) {
	let div = document.createElement('div');
	div.classList.add('tokens');
	div.append(...tokens.flatMap(({n, v, m, i, d, e, u}) => {
		let el;
		if (e) {
			let cps = show_mapped ? e : u;
			el = document.createElement('a');
			el.href = `https://emojipedia.org/${String.fromCodePoint(...cps)}`;
			el.classList.add('glyph');
			for (let cp of cps) {
				let span = document.createElement('span');
				if (cp == 0x200D) {
					span.classList.add('mod', 'zwj');
					span.innerHTML = 'ZWJ';
				} else if (cp == 0xFE0F) {
					span.classList.add('mod', 'dropped', 'style');
					span.innerHTML = 'FE0F';
				} else if (cp == 0x20E3) {
					span.classList.add('mod', 'keycap');
					span.innerHTML = 'Keycap';
				} else if (cp >= 0xE0020 && cp <= 0xE007F) {
					cp -= 0xE0000;
					let ch = String.fromCodePoint(cp);
					if (cp === 0x7F) {
						span.classList.add('mod');
						span.innerHTML = 'TagEnd';
					} else {
						if (is_printable_ascii(ch)) {
							span.innerHTML = ch;
						} else {
							span = document.createElement('code');
							span.innerHTML = hex_cp(cp);
						}
						span.classList.add('mod', 'tag');
					}
				} else if (!e.includes(cp)) { 
					span = document.createElement('code');
					span.classList.add('mod', 'dropped'); 
					span.innerHTML = hex_cp(cp);
				} else {
					span.classList.add('emoji');
					span.innerHTML = String.fromCodePoint(cp);
				}
				el.append(span);
			}
		} else if (n) {
			el = document.createElement('div');
			el.classList.add('nf');
			el.append(dom_from_tokens(u, show_mapped));
			/*
			let span = document.createElement('span');
			span.innerHTML = '&rarr;';
			el.append(span);
			el.append(dom_from_tokens([{v: n}], true));*/
		} else {
			el = document.createElement('div');
			if (v) {
				el.innerHTML = str(...v);
				el.title = tooltip(v);
				el.classList.add('valid');				
			} else if (m) {
				el.classList.add('mapped');
				for (let cp of (show_mapped ? m : u)) {
					let span = document.createElement('span');
					span.innerHTML = str(cp);	
					span.title = tooltip([cp])
					el.append(span);
				}
			} else if (i) {
				//if (is_norm) return []; // hide
				el = document.createElement('code');
				el.innerHTML = hex_cp(i); 
				el.title = tooltip([i]);
				el.classList.add('ignored');		
			} else if (d !== undefined) {			
				el.classList.add('disallowed');
				el.innerHTML = str(d);
				el.title = tooltip([d]);
			} else {
				el.classList.add('stop');
				el.innerHTML = '.';
			}
		}
		return el;
	}));
	return div;
}

export function use_default_style() {
	let style = document.createElement('style');
	style.innerText = `
	.tokens {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}
	.tokens > * {
		padding: 2px 4px;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.tokens a {
		text-decoration: none;
	}
	.tokens a:hover {
		outline: 2px solid #00f;
	}
	.tokens .valid {
		border-radius: 5px;
		background: #cfc;
		border: 2px solid #0a0;
		line-break: anywhere;
	}
	.tokens .ignored {
		color: #fff;
		background: #aaa;
		min-width: 5px;
	}
	.tokens .disallowed {
		background: #f66;	
	}
	.tokens .mapped {
		display: flex;
		border: 2px solid #66f;
		background: #ccf;
		border-radius: 5px;
	}
	.tokens .mapped span {
		margin-bottom: -4px;
		border-bottom: 4px solid #000;
	}
	.tokens .stop {
		font-weight: bold;
	}
	.tokens .glyph {
		border: 2px solid #0aa;
		border-radius: 0.5rem;
		background: #cff;
	}
	.tokens .mod {
		font-size: 70%;
		padding: 2px;
		background: #333;
		color: #fff;
		border-radius: 5px;
	}
	.tokens .mod.zwj {
		background: #0aa;
	}
	.tokens .mod.tag {
		background: #33f;
	}
	.tokens .mod.dropped {
		background: #aaa;
		min-width: 5px;
	}
	.tokens .nf {
		display: flex;
		border: 2px solid #800;
		background: #fcc;
		border-radius: 5px;
	}
	.tokens code {
		font-size: 90%;
		padding: 2px;
		border-radius: 5px;
		color: #fff;
		background: rgba(0, 0, 0, .3);
		align-self: center;
	}`;
	document.body.append(style);
}