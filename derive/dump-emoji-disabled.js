// dump emoji that should be disallowed

import {UNICODE, PRINTER} from './unicode-version.js';

PRINTER.js_header();

console.log();
for (let cp of UNICODE.props().Regional_Indicator) {
	console.log(PRINTER.js(cp));
}

console.log();
let {Emoji_Modifier} = UNICODE.emoji_data();
for (let {cp} of Emoji_Modifier) {
	console.log(PRINTER.js(cp));
}

/*
console.log();
let {Emoji_Component} = UNICODE.emoji_data();
for (let {cp} of Emoji_Component) {
	console.log(PRINTER.js(cp));
}
*/
