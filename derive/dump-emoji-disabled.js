// dump emoji that should be disallowed

import {UNICODE, PRINTER} from './unicode-version.js';

PRINTER.js_header();

// single regionals
console.log();
for (let cp of UNICODE.read_props().Regional_Indicator) {
	console.log(PRINTER.js(cp));
}

// skin color modifiers
console.log();
for (let {cp} of UNICODE.read_emoji_data().Emoji_Modifier) {
	console.log(PRINTER.js(cp));
}

/*
console.log();
let {Emoji_Component} = UNICODE.emoji_data();
for (let {cp} of Emoji_Component) {
	console.log(PRINTER.js(cp));
}
*/
