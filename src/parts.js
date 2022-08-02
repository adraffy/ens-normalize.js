import {escape_for_html, is_printable_ascii, hex_cp} from './utils.js';

function format_cps(v) {
	return escape_for_html(String.fromCodePoint(...v), cp => {
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

function create_arrow_span() {
	let span = document.createElement('span');
	span.classList.add('arrow');
	span.innerHTML = '🡆'; //'&rarr;';
	return span;
}

export function dom_from_tokens(tokens, before) {
	let div = document.createElement('div');
	div.classList.add('tokens');
	if (before) {
		// dont use normalized form
		tokens = tokens.flatMap(token => {
			if (token.type === 'nfc') {
				return token.tokens;
			} else {
				return token;
			}
		});
	}
	div.append(...tokens.flatMap(token => {
		let el;
		if (token.type === 'emoji') {
			let cps = before ? token.input : token.cps;
			el = document.createElement('a');
			el.href = `https://emojipedia.org/${String.fromCodePoint(...token.emoji)}`;
			el.classList.add('glyph');
			el.append(...cps.map((cp, i) => {
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
				/*} else if (!before && !e.includes(cp)) { 
					span = document.createElement('code');
					span.classList.add('mod', 'dropped'); 
					span.innerHTML = hex_cp(cp);*/
				} else {
					span.classList.add('emoji');
					span.innerHTML = String.fromCodePoint(cp);
				}
				return span;
			}));
		} else if (token.type === 'nfc') {
			el = document.createElement('div');
			el.classList.add('nfc');
			let lhs = dom_from_tokens(token.tokens, false);
			lhs.classList.add('before');
			let rhs = document.createElement('div');
			rhs.classList.add('valid');
			rhs.innerHTML = format_cps(token.cps);
			rhs.title = tooltip(token.cps);
			el.append(lhs, create_arrow_span(), rhs);
		} else {
			el = document.createElement('div');
			if (token.type === 'valid') {
				el.classList.add('valid');
				el.innerHTML = format_cps(token.cps);
				el.title = tooltip(token.cps);
			} else if (token.type === 'mapped') {
				el.classList.add('mapped');
				let span = document.createElement('span');
				span.classList.add('before');
				span.innerHTML = format_cps([token.cp]);	
				span.title = tooltip([token.cp]);
				el.append(span);
				if (!before) {
					el.append(create_arrow_span(), ...token.cps.map(cp => {
						let span = document.createElement('span');
						span.innerHTML = format_cps([cp]);	
						span.title = tooltip([cp])
						return span;
					}));
				}
			} else if (token.type === 'ignored') {
				el = document.createElement('code');
				el.innerHTML = hex_cp(token.cp); 
				el.title = tooltip([token.cp]);
				el.classList.add('ignored');
			} else if (token.type === 'disallowed') {
				el.classList.add('disallowed');
				el.innerHTML = format_cps([token.cp]);
				el.title = tooltip([token.cp]);
			} else if (token.type === 'stop') {
				el.classList.add('stop');
				el.innerHTML = '.';
			} else {
				throw new TypeError(`unknown token type: ${token.type}`);
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
	.tokens .mapped span:first-child {
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
	.tokens .arrow {
		color: rgba(0, 0, 0, 0.35);
	}
	.tokens .nfc {
		display: flex;
		border: 2px solid #fa0;
		background: #fd8;
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