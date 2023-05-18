import {writeFileSync} from 'node:fs';
import {explode_cp} from '../utils.js';
import {UNICODE} from '../unicode-version.js';
import {SCRIPT_GROUPS, SCRIPT_EXTENSIONS, DISALLOWED_SCRIPTS, RESTRICTED_SCRIPTS} from '../rules/scripts.js';

function fmt_cp(cp) {
	return `\`${hex_cp(cp)} (${String.fromCodePoint(cp)}) ${UNICODE.get_name(cp)}\``;
}

function script_name(abbr) {
	let script = UNICODE.script_map.get(abbr);
	return script.name;
}

let lines = [];

lines.push(`# Groups`);

lines.push('| Group Name | Primary Scripts | Secondary Scripts | Restricted CM | Extra Characters |');
lines.push(`| - | - | - | :-: | - |`);
for (let g of SCRIPT_GROUPS) {
	let extra = '';
	if (g.extra) {
		extra = `\`${String.fromCodePoint(...g.extra.flat(Infinity).flatMap(x => typeof x === 'string' ? explode_cp(x) : x))}\``;
	}
	lines.push(`| **${g.name}** | ${g.test.map(script_name).join(', ')} | ${(g.rest ?? []).map(script_name).join(', ')} | ${g.cm ? 'Yes' : ''} | ${extra} |`);
}
for (let abbr of RESTRICTED_SCRIPTS) {
	lines.push(`| **${abbr}†** | ${script_name(abbr)} |  |  |  |`);
}

lines.push('');
lines.push('† Restricted Group: [Excluded](https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers) or [Limited-Use Script](https://www.unicode.org/reports/tr31/#Table_Limited_Use_Scripts)');
lines.push('');

lines.push('## Disallowed Scripts');
for (let abbr of DISALLOWED_SCRIPTS) {
	lines.push(`1. ${UNICODE.script_map.get(abbr).name}`);
}

writeFileSync(new URL('./groups.md', import.meta.url), lines.join('\n'));
