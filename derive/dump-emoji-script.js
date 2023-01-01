import {readFileSync} from 'node:fs';
import {UNICODE, PRINTER} from './unicode-version.js';
import {group_by, print_section} from './utils.js';

const SPEC = JSON.parse(readFileSync(new URL('./output/spec.json', import.meta.url))); // note: requires spec

for (let [script, cps] of group_by(new Set(SPEC.emoji.flat()), cp => UNICODE.get_script(cp))) {
	console.log(script.abbr, cps.length);
	if (script.abbr !== 'Zyyy') {
		print_section(`${script.description} (${cps.length})`);
		for (let cp of cps) {
			console.log(PRINTER.desc_for_cp(cp));
		}
	}
}

/*
// conclusion: emoji are Zyyy except for:
==== [Zinh] Inherited (3) ====
FE0F (◌️) VARIATION SELECTOR-16        ==> ignored
20E3 (◌⃣) COMBINING ENCLOSING KEYCAP  ==> component
200D (�) ZERO WIDTH JOINER           ==> component
*/