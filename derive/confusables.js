import {SPEC, NF} from './unicode-version.js';
import { compare_arrays, explode_cp } from './utils.js';

let confusables = SPEC.confusables();
let scripts = SPEC.scripts();

let ignored = new Set(['Common', 'Inherited']);
let script_sets = scripts.filter(x => !ignored.has(x[0])).map(([name, cps]) => [name, new Set(cps)]);

function get_scripts(cps) {
	let found = new Set();
	for (let cp of cps) {
		for (let [name, set] of script_sets) {
			if (set.has(cp)) {
				found.add(name);
			}
		}
	}
	return [...found].sort();
}

//console.log(get_scripts(explode_cp('raffy')));

function check_scripts(cps) {
	let raw = get_scripts(cps);
	let nfc = get_scripts(NF.nfc(cps));
	let nfd = get_scripts(NF.nfd(cps));
	if (compare_arrays(raw, nfc) || compare_arrays(nfc, nfd)) {
		console.log('Inconsistant Scripts: ', {cps, raw, nfc, nfd});
	}
}

for (let [target, cps] of confusables) {
	check_scripts(target);
	for (let cp of cps) {
		check_scripts([cp]);
	}
}
