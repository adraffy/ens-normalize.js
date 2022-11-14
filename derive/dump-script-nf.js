import {UNICODE, SCRIPTS, NF} from './unicode-version.js';
import {print_section} from './utils.js';
import {SCRIPT_GROUPS, RESTRICTED_SCRIPTS} from './rules/scripts.js';
import { AUGMENTED_ALL, read_excluded_scripts, read_limited_scripts } from './unicode-logic.js';

let all = ['Zyyy', 'Zinh'];

let leftover = new Set(SCRIPTS.entries.map(x => x.abbr));
all.forEach(abbr => leftover.delete(abbr));

for (let ordered of SCRIPT_GROUPS) {
	let cps = [ordered.test, ordered.rest.flatMap(x => x === AUGMENTED_ALL ? all : x)].flat().flatMap(abbr => SCRIPTS.require(abbr).set);
	if (ordered.extra) cps.push(...ordered.extra);
	if (cps.some(cp => NF.decomposes(cp))) {
		console.log(ordered.name);
	}
	ordered.test.forEach(abbr => leftover.delete(abbr));
}

print_section('Limited');
for (let abbr of read_limited_scripts()) {
	leftover.delete(abbr);
	if ([...SCRIPTS.require(abbr).set].some(cp => NF.decomposes(cp))) {
		console.log(abbr);
	}
}
print_section('Excluded');
for (let abbr of read_excluded_scripts()) {
	leftover.delete(abbr);
	if ([...SCRIPTS.require(abbr).set].some(cp => NF.decomposes(cp))) {
		console.log(abbr);
	}
}

print_section('Leftover');
for (let abbr of leftover) {
	if ([...SCRIPTS.require(abbr).set].some(cp => NF.decomposes(cp))) {
		console.log(abbr);
	}
}