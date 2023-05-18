import {readFileSync, writeFileSync} from 'node:fs';
import {hex_cp} from '../../derive/utils.js';
import {UNICODE, IDNA} from '../../derive/unicode-version.js';
import {EMOJI_DEMOTED, EMOJI_DISABLED, EMOJI_SEQ_BLACKLIST, EMOJI_SEQ_WHITELIST} from '../../derive/rules/emoji.js';
import {ens_emoji} from '../../src/lib.js';
//import {append_table} from './utils.js';

function fmt_cp(cp) {
	return `\`${hex_cp(cp)} (${String.fromCodePoint(cp)}) ${UNICODE.get_name(cp)}\``;
}

const idna_mapped = new Map(IDNA.mapped);

const emoji_map = new Map(JSON.parse(readFileSync(new URL('../../derive/output/emoji-info.json', import.meta.url))).map(info => {
	return [info.form, info];
}));

const EMOJI = ens_emoji();

let lines = [];
let toc_index = 1;
function add_toc(name, count) {
	let anchor = name.toLowerCase().replaceAll(' ', '-');
	let display = name;
	if (count) display += ` (${count})`;
	lines.splice(toc_index++, 0, `1. [${display}](#${anchor})`);
	lines.push(`## <a id="${anchor}">${display}</a>`);
}

lines.push(`# Emoji`);

// should this include an emoji table?
// 20230517: ya

add_toc('Valid Emoji Sequences', EMOJI.length);
lines.push(`| Form | Codepoints | Name |`);
lines.push('| :-: | :- | :- |');
for (let emoji of EMOJI) {
	let form = String.fromCodePoint(...emoji);
	let info = emoji_map.get(form);
	lines.push(`| \`${form}\` | \`${emoji.map(hex_cp).join(' ')}\` | ${info.name} |`)
}

add_toc('Disabled Emoji Characters', EMOJI_DISABLED.length);
lines.push(`| Form | Codepoint | Name |`);
lines.push('| :-: | :- | :- |');
for (let cp of EMOJI_DISABLED) {
	let form = String.fromCodePoint(cp);
	let info = emoji_map.get(form);
	lines.push(`| \`${form}\` | \`${hex_cp(cp)}\` | ${info.name} |`)
}

add_toc('Demoted Emoji Characters', EMOJI_DEMOTED.length);
//append_table(lines, EMOJI_DEMOTED);
for (let cp of EMOJI_DEMOTED) {
	let cps = idna_mapped.get(cp);
	if (cps) {
		lines.push(`1. ${fmt_cp(cp)} &rarr; ${cps.map(fmt_cp).join(' + ')}`);
	} else {
		lines.push(`1. ${fmt_cp(cp)} &rarr; *not an Emoji*`);
	}
}


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
