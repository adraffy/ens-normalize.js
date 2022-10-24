import {SCRIPTS} from './unicode-version.js';
import SPEC from './output/spec.json' assert {type: 'json'};
import {group_by} from './utils.js';

for (let [script, cps] of group_by(new Set(SPEC.emoji.flat()), cp => SCRIPTS.get_script(cp))) {
	console.log(script.abbr, cps.length);
}

// conclusion: emoji are Zyyy except for Zinh (3) [FE0F, 200D, 20E3]  