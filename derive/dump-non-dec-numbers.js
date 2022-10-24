// https://www.unicode.org/reports/tr39/#Mixed_Number_Detection

import {UNICODE, SCRIPTS} from './unicode-version.js';
import SPEC from './output/spec.json' assert {type: 'json'};

let valid = new Set(SPEC.valid);
let script = SCRIPTS.require('Hira');

for (let cp of UNICODE.cm) {
	if (script.set.has(cp)) {
		console.log(UNICODE.js_format(cp));
	}
}