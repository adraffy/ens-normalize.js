import {readFileSync, writeFileSync} from 'node:fs';
import {ens_emoji, ens_tokenize} from '../../src/lib.js';
import {tt, hex_cp, fmt_cp} from './utils.js';
import {
	EMOJI_DEMOTED,
	EMOJI_DISABLED, 
	EMOJI_SEQ_BLACKLIST, 
	EMOJI_SEQ_WHITELIST
} from '../../derive/rules/emoji.js';

const EMOJI_INFO = new Map(JSON.parse(readFileSync(new URL('../../derive/output/emoji-info.json', import.meta.url))).map(info => {
	return [info.form, info];
}));

const EMOJI = ens_emoji();

let lines = [];
let toc_index = 1;
function add_toc(name, count) {
	let anchor = name.toLowerCase().replaceAll(' ', '-');
	let display = name;
	if (Number.isInteger(count)) display += ` (${count})`;
	lines.splice(toc_index++, 0, `1. [${display}](#${anchor})`);
	lines.push(`## <a id="${anchor}">${display}</a>`);
}

lines.push(`# Supported Emoji`);

// should this include an emoji table?
// 20230517: ya

add_toc('Valid Emoji Sequences', EMOJI.length);
lines.push(`| Codepoints | Form | Name |`);
lines.push('| -: | :-: | :- |');
for (let emoji of EMOJI) {
	let form = String.fromCodePoint(...emoji);
	let info = EMOJI_INFO.get(form);
	lines.push(`| ${tt(emoji.map(hex_cp).join(' '))} | ${tt(form)} |  ${info.name} |`)
}

add_toc('Disabled Emoji Characters', EMOJI_DISABLED.length);
lines.push(`| Codepoint | Form | Name |`);
lines.push('| -: | :-: | :- |');
for (let cp of EMOJI_DISABLED.sort((a, b) => a - b)) {
	let form = String.fromCodePoint(cp);
	let info = EMOJI_INFO.get(form);
	lines.push(`| ${tt(form)} | ${tt(hex_cp(cp))} | ${info.name} |`)
}

add_toc('Demoted Emoji Characters', EMOJI_DEMOTED.length);
let lines_mapped = [];
let lines_passed = [];
for (let cp of EMOJI_DEMOTED.sort((a, b) => a - b)) {
	let form = String.fromCodePoint(cp);
	let info = EMOJI_INFO.get(form);
	let line = `| ${tt(hex_cp(cp))} | ${tt(form)} | ${info.name}`;
	let [token] = ens_tokenize(form);
	switch (token.type) {
		case 'mapped': {
			lines_mapped.push(`${line} | ${tt(String.fromCodePoint(...token.cps))} | ${token.cps.map(fmt_cp).join('<br>')} |`);
			break;
		}
		case 'disallowed': {
			lines_passed.push(`${line} | ❌️ |`);
			break;
		}
		case 'valid': {
			lines_passed.push(`${line} | ✅️ |`);
			break;
		}
		default: {
			console.log(token);
			throw new Error('bug');
		}
	}
}
lines.push(`### <a id="demoted-mapped">Mapped to Non-Emoji (${lines_mapped.length})</a>`);
lines.push(`| Codepoint | Form | Name | Mapped | Characters |`);
lines.push('| -: | :-: | :- | :-: | :- |');
lines.push(...lines_mapped);
lines.push(`### <a id="demoted-unchanged">Non-Emoji (${lines_passed.length})</a>`);
lines.push(`| Form | Codepoint | Name | Valid |`);
lines.push('| -: | :-: | :- | :-: |');
lines.push(...lines_passed);

add_toc('Emoji Sequence Whitelist', EMOJI_SEQ_WHITELIST.length);
if (EMOJI_SEQ_WHITELIST.length) {
	throw new Error('nyi');
} else {
	lines.push(`* *None*`);
}

add_toc('Emoji Sequence Blacklist', EMOJI_SEQ_BLACKLIST.length);
if (EMOJI_SEQ_BLACKLIST.length) {
	throw new Error('nyi');
} else {
	lines.push(`* *None*`);
}

writeFileSync(new URL('./emoji.md', import.meta.url), lines.join('\n'));
