import {SPEC, NF, SCRIPTS} from '../unicode-version.js';
import {compare_arrays} from '../utils.js';

let confusables = SPEC.confusables();

function get_scripts(cps) {
	let set = SCRIPTS.get_script_set(cps);
	set.delete('Zinh'); // Inherited
	set.delete('Zyyy'); // Common
	set.delete('Zzzz'); // Unknown
	return [...set].sort();
}

function check_scripts(cps) {
	let raw = get_scripts(cps);
	let nfc = get_scripts(NF.nfc(cps));
	let nfd = get_scripts(NF.nfd(cps));
	if (compare_arrays(raw, nfc) || compare_arrays(nfc, nfd)) {
		console.log({cps, raw, nfc, nfd});
	}
}

for (let [target, cps] of confusables) {
	check_scripts(target);
	for (let cp of cps) {
		check_scripts([cp]);
	}
}
