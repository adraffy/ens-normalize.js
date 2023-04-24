import {writeFileSync} from 'node:fs';
import {hex_cp} from '../utils.js';
import {UNICODE, IDNA} from '../unicode-version.js';
import {EMOJI_DEMOTED, EMOJI_DISABLED, EMOJI_SEQ_BLACKLIST, EMOJI_SEQ_WHITELIST} from '../rules/emoji.js';
//import {append_table} from './utils.js';

function fmt_cp(cp) {
	return `\`${hex_cp(cp)} (${String.fromCodePoint(cp)}) ${UNICODE.get_name(cp)}\``;
}

let idna_mapped = new Map(IDNA.mapped);

let lines = [];

lines.push(`# Emoji Considerations`)

lines.push(`## Demoted Emoji`);
//append_table(lines, EMOJI_DEMOTED);
for (let cp of EMOJI_DEMOTED) {
	let cps = idna_mapped.get(cp);
	if (cps) {
		lines.push(`1. ${fmt_cp(cp)} &rarr; ${cps.map(fmt_cp).join(' + ')}`);
	} else {
		lines.push(`1. ${fmt_cp(cp)} &rarr; *not an Emoji*`);
	}
}

lines.push('## Disabled Emoji');
//append_table(lines, EMOJI_DISABLED);
for (let cp of EMOJI_DISABLED) {
	lines.push(`1. \`${hex_cp(cp)} (${String.fromCodePoint(cp)}) ${UNICODE.get_name(cp)}\``);
}

lines.push('## Emoji Sequence Whitelist');
if (EMOJI_SEQ_WHITELIST.length) {
	throw new Error('nyi');
} else {
	lines.push(`* *None*`);
}

lines.push('## Emoji Sequence Blacklist');
if (EMOJI_SEQ_BLACKLIST.length) {
	throw new Error('nyi');
} else {
	lines.push(`* *None*`);
}

writeFileSync(new URL('./emoji.md', import.meta.url), lines.join('\n'));
