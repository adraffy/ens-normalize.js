// https://www.unicode.org/reports/tr24/
// https://www.unicode.org/reports/tr9/
// https://www.w3.org/International/articles/inline-bidi-markup/uba-basics

import {SCRIPTS, UNICODE} from './unicode-version.js';
import {tally_entries} from './utils.js';

console.log([...tally_entries(UNICODE.chars, x => x.bidi_class).entries()].map(([k, v]) => [k, v.length]));

let per_script = tally_entries(UNICODE.chars.filter(x => {
	switch (x.bidi_class) {
		case 'R':
		case 'AL': return true;
	}
}), x => SCRIPTS.get_script(x.cp)?.abbr);
console.log([...per_script.entries()].map(([k, v]) => [k, v.length]));

for (let cp of per_script.get('Zyyy')) {
	console.log(UNICODE.js_format(cp));
}