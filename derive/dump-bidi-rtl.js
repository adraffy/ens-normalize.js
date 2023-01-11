// https://www.unicode.org/reports/tr24/
// https://www.unicode.org/reports/tr9/
// https://www.w3.org/International/articles/inline-bidi-markup/uba-basics

import {UNICODE, PRINTER} from './unicode-version.js';
import {group_by} from './utils.js';

// print bidi tally
console.log([...group_by(UNICODE.char_map.values(), x => x.bidi_class).entries()].map(([k, v]) => [k, v.length]));

// scripts that contain RTL characters
let per_script = group_by([...UNICODE.char_map.values()].filter(x => {
	switch (x.bidi_class) {
		case 'R':
		case 'AL': return true;
	}
}), x => UNICODE.get_script(x.cp)?.abbr);
console.log([...per_script.entries()].map(([k, v]) => [k, v.length]));

// all common RTL characters
for (let ch of per_script.get('Zyyy')) {
	console.log(PRINTER.desc_for_cp(ch.cp));
}

/*
// 20221213: do any ignored characters have directionality?
// answer: no :chonkscream:
for (let cp of IDNA.ignored) {
	console.log(cp, UNICODE.char_map.get(cp).bidi_class);
}
*/