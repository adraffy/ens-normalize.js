// https://unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
// https://unicode.org/reports/tr31/#Table_Limited_Use_Scripts

import {UNICODE} from './unicode-version.js';
import {read_excluded_scripts, read_limited_scripts} from './unicode-logic.js';
import {print_section} from './utils.js';

function dump(v) {
	for (let abbr of v) {
		console.log(`'${abbr}', // ${UNICODE.require_script(abbr).name}`);
	}
}

print_section('Excluded');
dump(read_excluded_scripts());

print_section('Limited Use');
dump(read_limited_scripts());
