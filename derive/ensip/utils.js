import {hex_cp} from '../utils.js';
import {UNICODE} from '../unicode-version.js';

export function append_table(lines, cps) {
	lines.push(`| Codepoint | Form | Character Name |`);
	lines.push('| -: | :-: | :- |');
	for (let cp of cps) {
		lines.push(`| \`${hex_cp(cp)}\` | \`${String.fromCodePoint(cp)}\` | ${UNICODE.get_name(cp)} |`)
	}
}