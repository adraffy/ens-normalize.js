// https://unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
// https://unicode.org/reports/tr31/#Table_Limited_Use_Scripts
// https://unicode.org/reports/tr31/#Table_Recommended_Scripts

import {UNICODE} from './unicode-version.js';
import {print_section} from './utils.js';

for (let [key, abbrs] of Object.entries(UNICODE.read_script_kinds())) {
	print_section(key);
	for (let abbr of abbrs) {
		let script = UNICODE.require_script(abbr);
		console.log(`'${abbr}', // ${script.name} (${script.map.size})`);
	}
	console.log();
}