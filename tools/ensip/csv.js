import {IDNA} from '../../derive/unicode-version.js';
import DISALLOWED from '../../derive/rules/chars-disallow.js';
import {read_spec} from '../../validate/data.js';
import {write_csv} from './utils.js';

const SPEC = read_spec();

let allowed = new Set([
	...IDNA.valid,
	...IDNA.ignored,
	...IDNA.mapped.map(v => v[0])
]);
let disallowed = [...DISALLOWED].filter(cp => allowed.has(cp));

// use default ordering, don't sort
//disallowed.sort((a, b) => a - b);

// TODO: figure out how to reveal some of these comments
/*
let lines = [];
lines.push(`# Additional Disallowed Characters (${disallowed.length})`);
lines.push(`| Codepoint | Form | Name |`);
lines.push('| -: | :-: | :- |');
for (let cp of disallowed) { 
	lines.push(`| ${tt(hex_cp(cp))} | ${tt(String.fromCodePoint(cp))} | ${UNICODE.get_name(cp)} |`)
}
writeFileSync(new URL('./disallowed.md', import.meta.url), lines.join('\n'));
*/

write_csv('disallowed', disallowed);
write_csv('ignored', SPEC.ignored,  {form: false});
write_csv('escape', SPEC.escape, {form: false});
write_csv('fenced', SPEC.fenced.map(x => x[0]));
write_csv('nfc_check', SPEC.nfc_check);
write_csv('nsm', SPEC.nsm);
write_csv('cm', SPEC.cm);