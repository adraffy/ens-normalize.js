import {should_escape, safe_str_from_cps} from './lib.js';
import {hex_cp} from './utils.js';

function hex_seq(cps) {
	return cps.map(hex_cp).join(' ');
}

function create_arrow_span() {
	let span = document.createElement('span');
	span.classList.add('arrow');
	span.innerHTML = '➔'; // '→'; 
	return span;
}

function span_from_cp(cp, in_emoji) {
	let span = document.createElement('span');
	if (cp == 0x200D) {
		span.classList.add('mod', 'zwj');
		span.innerText = 'ZWJ';
	} else if (cp == 0x200C) {
		span.classList.add('mod', 'zwj');
		span.innerText = 'ZWNJ';
	} else if (cp == 0xFE0F) {
		span.classList.add('mod', 'dropped', 'style');
		span.innerText = 'FE0F';
	} else if (cp == 0x20E3) {
		span.classList.add('mod', 'keycap');
		span.innerText = 'Keycap';
	} else if (cp >= 0xE0021 && cp <= 0xE007E) { // printable ascii tag
		span.classList.add('mod', 'tag');
		span.innerText = String.fromCodePoint(cp - 0xE0000);
	} else if (cp == 0xE007F) { // tag end
		span.classList.add('mod', 'tag', 'end');
		span.innerText = '⌫'; // 🏷️
	} else if (!in_emoji && should_escape(cp)) {
		span.classList.add('code');
		span.innerText = hex_cp(cp);
	} else {
		span.innerText = safe_str_from_cps([cp]);
	}
	return span;
}

// idea
//export function dom_from_token(token) {

function format_tooltip(obj, extra) {
	let lines = Object.entries(obj).map(([k, v]) => `${k}: ${v}`);
	if (Array.isArray(extra)) lines.push(...extra);	
	return lines.join('\n');
}

function isolated_safe(cps) {
	return cps.map(cp => safe_str_from_cps([cp])).join('\u{200B}')
}

// TODO: these options are shit, fix this
export function dom_from_tokens(tokens, {
	before = false, 
	tld_class = true,
	components = false, 
	emoji_url = 'https://emojipedia.org/%s',
	extra = () => {},
} = {}) {
	let div = document.createElement('div');
	div.classList.add('tokens');
	/*
	if (before) {
		// dont use normalized form unless its simple
		tokens = tokens.flatMap(token => {
			if (token.type === 'nfc' && !token.tokens.every(t => t.type == 'valid')) {
				return token.tokens;
			} else {
				return token;
			}
		});
	}
	*/
	div.append(...tokens.map((token, i) => {
		let el;
		switch (token.type) {
			case 'emoji': {
				el = document.createElement(emoji_url ? 'a' : 'span');
				if (emoji_url) el.href = emoji_url.replace('%s', String.fromCodePoint(...token.emoji));
				let cps = before ? token.input : token.cps;
				if (components) {
					el.append(...cps.map(cp => span_from_cp(cp, true)));
				} else {
					el.innerText = String.fromCodePoint(...token.emoji); // use fully-qualified form
				}
				el.title = format_tooltip({
					Type: 'Emoji',
					Hex: hex_seq(cps),
					Beautified: hex_seq(token.emoji),
				}, extra(token.type, cps));
				break;
			}
			case 'nfc': {
				el = document.createElement('div');
				// get the cps from the original tokens
				let cps0 = token.tokens0.flatMap(t => t.type === 'valid' ? t.cps : t.cp); // this can only be mapped/ignored/valid
				// break every valid token into individual characters
				let lhs = dom_from_tokens(token.tokens0.flatMap(t => t.type === 'valid' ? t.cps.map(cp => ({type: 'valid', cps: [cp]})) : t), {components, before, emoji_url, extra});
				lhs.title = format_tooltip({
					Type: 'NFC (Unnormalized)',
					Hex: hex_seq(cps0),
				}, extra(token.type, cps0));
				el.append(lhs);
				if (!before) {
					let rhs = dom_from_tokens(token.tokens, {components, emoji_url, extra});
					rhs.title = format_tooltip({
						Type: 'NFC (Normalized)',
						Hex: hex_seq(token.cps),
					}, extra(token.type, token.cps));
					el.append(create_arrow_span(), rhs);
				}
				break;
			}
			case 'valid': {
				el = document.createElement('span');		
				let form = safe_str_from_cps(token.cps);
				if (tld_class && (tokens.length == 1 || (i === tokens.length-1 && tokens[i-1].type === 'stop')) && /[a-z]/.test(form)) { 
					// theres just 1 token/or we're the last token with a stop before us
					el.classList.add(form);
				}
				el.innerText = form;
				el.title = format_tooltip({
					Type: 'Valid',
					Hex: hex_seq(token.cps),
				}, extra(token.type, token.cps));
				break;
			}
			case 'mapped': {
				el = document.createElement('div');
				let span_src = document.createElement('span');
				span_src.classList.add('before');
				span_src.innerText = safe_str_from_cps([token.cp]);	// isolate ? isolated_safe([token.cp]) : 
				span_src.title = format_tooltip({
					Type: 'Mapped (Match)',
					Hex: hex_cp(token.cp),
				}, extra(token.type, [token.cp]));
				el.append(span_src);
				if (!before) {
					let span_dst = document.createElement('span');
					span_dst.innerText = isolated_safe(token.cps); // safe_str_from_cps(token.cps);
					span_dst.title = format_tooltip({
						Type: 'Mapped (Replacement)',
						Hex: hex_seq(token.cps),
					}, extra(token.type, token.cps));
					el.append(create_arrow_span(), span_dst);
				}
				break;
			}
			case 'stop':
			case 'ignored':
			case 'disallowed': {
				el = span_from_cp(token.cp);
				el.title = format_tooltip({
					Type: token.type,
					Hex: hex_cp(token.cp),
				}, extra(token.type, [token.cp]));
				break;
			}
			default: throw new TypeError(`unknown token type: ${token.type}`);
		}
		el.classList.add(token.type);
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
		border-radius: 5px;
		overflow: hidden;
	}
	.tokens a {
		text-decoration: none;
	}
	.tokens a:hover {
		border-color: #00f;
	}
	.tokens .valid {
		background: #cfc;
		border: 2px solid #0a0;
		line-break: anywhere;
	}
	.tokens .valid.eth {
		color: #fff;
		background: #58f;
		border: none;
	}
	.tokens .valid.art {
		color: #fff;
		background: #333; /*#f63;*/
		border: none;
	}
	.tokens .valid.com,
	.tokens .valid.net,
	.tokens .valid.org,
	.tokens .valid.io,
	.tokens .valid.cash,
	.tokens .valid.xyz {
		color: #fff;
		background: #0a0;
		border: none;
	}
	.tokens .ignored {
		color: #fff;
		background: #aaa;
		font-size: 75%;
		font-family: monospace;
	}
	.tokens .disallowed {
		background: #c00;	
		min-width: 5px;
		min-height: 1em;
		border-radius: 5px;
		color: #fff;
	}
	.tokens .disallowed.code {
		font-size: 75%;
		background: #800;
	}
	.tokens .disallowed.mod {
		border: 2px solid #800;
		font-size: 80%;
	}
	.tokens .disallowed.mod.tag {
		background: #f00;
		color: #000;
	}
	.tokens .mapped {
		display: flex;
		border: 2px solid #66f;
		background: #ccf;
	}
	.tokens .mapped span:first-child {
		margin-bottom: -4px;
		border-bottom: 4px solid #000;
		text-align: center;
		min-width: 0.5rem;
	}
	.tokens .stop {
		font-weight: bold;
		background: linear-gradient(#fff, #ff0);
		padding-bottom: 0;
		border: 1px solid #ccc;
	}
	.tokens .emoji {
		border: 2px solid #0aa;
		background: #cff;
		color: #000;
	}
	.tokens .mod {
		color: #fff;
	}
	.tokens * .mod {
		font-size: 70%;
		padding: 2px;
		border-radius: 3px;
	}
	.tokens .emoji .mod {
		background: #333;
	}
	.tokens .emoji .mod.zwj {
		background: #0aa;
	}
	.tokens .emoji .mod.tag {
		background: #0aa;
	}
	.tokens .emoji .mod.tag.end {
		background: #066;
	}
	.tokens .emoji .mod.dropped {
		background: #aaa;		
	}
	.tokens .arrow {
		color: rgba(0, 0, 0, 0.35);
	}
	.tokens .code {
		font-family: monospace;
	}
	.tokens .nfc {
		display: flex;
		border: 2px solid #c80;
		background: #fd8;
		border-radius: 5px;
		padding: 2px;
	}`;
	document.body.append(style);
}