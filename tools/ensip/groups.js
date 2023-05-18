import {writeFileSync} from 'node:fs';
import {tt} from './utils.js';
import {explode_cp} from '../../src/utils.js';
import {UNICODE} from '../../derive/unicode-version.js';
import {
	SCRIPT_GROUPS, 
	SCRIPT_EXTENSIONS, 
	DISALLOWED_SCRIPTS, 
	RESTRICTED_SCRIPTS
} from '../../derive/rules/scripts.js';
import GROUP_ORDER from '../../derive/rules/group-order.js';

const ORDER = new Map(GROUP_ORDER.map((x, i, v) => [x, v.length - i]));
function order_of(name) { 
	return ORDER.get(name)|0;
}
SCRIPT_GROUPS.sort((a, b) => order_of(b.name) - order_of(a.name))

function script_name(abbr) {
	let script = UNICODE.script_map.get(abbr);
	return script.name;
}

let lines = [];

lines.push(`# Groups (${SCRIPT_GROUPS.length})`);

lines.push('| Group Name | Primary Scripts | Secondary Scripts | Restricted CM | Extra Characters |');
lines.push(`| - | - | - | :-: | - |`);
for (let g of SCRIPT_GROUPS.sort((a, b) => (ORDER.get(b)|0) - (ORDER.get(a)|0))) {
	let extra = '';
	if (g.extra) {
		extra = tt(String.fromCodePoint(...g.extra.flat(Infinity).flatMap(x => typeof x === 'string' ? explode_cp(x) : x)));
	}
	lines.push(`| ${tt(g.name)} | ${g.test.map(script_name).join(', ')} | ${(g.rest ?? []).map(script_name).join(', ')} | ${g.cm ? '✅️' : ''} | ${extra} |`);
}
for (let abbr of RESTRICTED_SCRIPTS) {
	lines.push(`| ${tt(abbr + '†')} | ${script_name(abbr)} | | | |`);
}

lines.push('');
lines.push('† Restricted Group: [Excluded](https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers) or [Limited-Use Script](https://www.unicode.org/reports/tr31/#Table_Limited_Use_Scripts)');
lines.push('');

lines.push('## Disallowed Scripts');
for (let abbr of DISALLOWED_SCRIPTS) {
	lines.push(`1. ${UNICODE.script_map.get(abbr).name}`);
}

writeFileSync(new URL('./groups.md', import.meta.url), lines.join('\n'));
