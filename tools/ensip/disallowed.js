import {writeFileSync} from 'node:fs';
import {hex_cp, tt} from './utils.js';
import {UNICODE, IDNA} from '../../derive/unicode-version.js';
import DISALLOWED from '../../derive/rules/chars-disallow.js';

let allowed = new Set([
	...IDNA.valid,
	...IDNA.ignored,
	...IDNA.mapped.map(v => v[0])
]);

let disallowed = [...DISALLOWED].filter(cp => allowed.has(cp));
// use default ordering, don't sort
//disallowed.sort((a, b) => a - b);

let lines = [];
let rows = [];

lines.push(`# Additional Disallowed Characters (${disallowed.length})`);
rows.push('Codepoint,Form,Name');

// TODO: figure out how to reveal some of these comments
lines.push(`| Codepoint | Form | Name |`);
lines.push('| -: | :-: | :- |');
for (let cp of disallowed) { 
	lines.push(`| ${tt(hex_cp(cp))} | ${tt(String.fromCodePoint(cp))} | ${UNICODE.get_name(cp)} |`)
	rows.push(`"${hex_cp(cp)}","${String.fromCodePoint(cp)}","${UNICODE.get_name(cp)}"`);
}

writeFileSync(new URL('./disallowed.md', import.meta.url), lines.join('\n'));
writeFileSync(new URL('./disallowed.csv', import.meta.url), rows.join('\n'));
