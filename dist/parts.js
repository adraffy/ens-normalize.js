function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

// my suggested inline ascii-safe unicode escape
// this is ES6 \u{X} without the \u
function quote_cp(cp) {
	return `{${hex_cp(cp)}}`;
}

function escape_name_for_html(s, quoter) {
	// printable w/o:
	// html: 0x26 &, 0x3C <, 0x3E >
	// quote: 0x00-0x20 control, 0x7F DEL, whitespace, joiners
	if (!quoter) quoter = quote_cp;
	return s.replace(/(?:([\x00-\x20\x7F\xA0\u200C\u200D\s])|([^\x21-\x25\x27-\x3B\x3D\x3F-\x7E]))/gu, 
		(_, a, b) => a ? quoter(a.codePointAt(0)) : `&#${b.codePointAt(0)};`);
}

function str(...v) {
	return escape_name_for_html(String.fromCodePoint(...v), cp => `<code>${hex_cp(cp)}</code>`);
}
function tooltip(cp) {
	return `Hex: 0x${hex_cp(cp)}\nDec: ${cp}`;
}

function dom_from_tokens(tokens, is_norm = false) {
	let div = document.createElement('div');
	div.classList.add('tokens');
	div.append(...tokens.map(({v, m, i, d, e, u}) => {
		let el;
		if (e) {
			let cps = is_norm ? e : u;
			el = document.createElement('a');
			el.href = `https://emojipedia.org/${String.fromCodePoint(...cps)}`;
			el.classList.add('glyph');
			for (let cp of cps) {
				let span = document.createElement('span');
				span.classList.add('mod');
				if (cp == 0x200C) {
					span.innerHTML = 'ZWNJ';
				} else if (cp == 0x200D) {
					span.classList.add('zwj');
					span.innerHTML = 'ZWJ';
				} else if (cp == 0xFE0F) {
					span.classList.add('style');
					span.innerHTML = 'FE0F';
				} else if (cp == 0x20E3) {
					span.classList.add('keycap');
					span.innerHTML = 'Keycap';
				} else {
					span.classList.remove('mod');
					span.classList.add('emoji');
					span.innerHTML = String.fromCodePoint(cp);
				}
				if (!e.includes(cp)) span.classList.add('ignored'); // meh
				el.append(span);
			}
		} else {
			el = document.createElement('div');
			if (v) {
				el.innerHTML = str(...v);
				el.classList.add('valid');
			} else if (m) {
				el.classList.add('mapped');
				for (let cp of (is_norm ? m : u)) {
					let span = document.createElement('span');
					span.innerHTML = str(cp);	
					span.title = tooltip(cp);
					el.append(span);
				}
			} else if (i) {
				if (!is_norm) {
					el.classList.add('ignored');
					el.innerHTML = `<code>${hex_cp(i)}</code>`;
					el.title = tooltip(i);
				}
			} else if (d !== undefined) {			
				el.classList.add('disallowed');
				el.innerHTML = str(d);
				el.title = tooltip(d);
			} else {
				el.classList.add('stop');
				el.innerHTML = '.';
			}
		}
		return el;
	}));
	return div;
}

function use_default_style() {
	let style = document.createElement('style');
	style.innerText = `
	.tokens {
		font-size: 16pt;
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
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
	}
	.tokens .ignored {
		color: #fff;
		background: #aaa;
		min-width: 0.3rem;
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
		background: #ffa;
	}
	.tokens .glyph {
		border: 2px solid #0aa;
		border-radius: 0.5rem;
		background: #cff;
	}
	.tokens .mod {
		font-size: 10pt;
		padding: 2px;
		background: #333;
		color: #fff;
		border-radius: 5px;
	}
	.tokens .mod.zwj {
		background: #0aa;
	}
	.tokens .mod.ignored {	
		background: #aaa;
	}
	.tokens code {
		font-size: 14pt;
		color: #fff;
		background: rgba(0, 0, 0, .5);
	}`;
	document.body.append(style);
}

export { dom_from_tokens, use_default_style };
