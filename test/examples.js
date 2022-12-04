// code that is not included in the library 
// but might useful

import {ens_normalize, ens_tokenize} from '../src/lib.js';

// is the string a emoji?
// returns true if one emoji glyph
function is_emoji(s) {
	let tokens = ens_tokenize(s);
	return tokens.length == 1 && tokens[0].type === 'emoji';
}

// is the string normalized?
// returns true if normalized,
// false transform required,
// or undefined if not normalizable
function is_normalized(s) {
	try {
		return ens_normalize(s) === s;
	} catch (err) {		
	}
}

console.log(is_emoji('a')); // false
console.log(is_emoji('💩')); // true

console.log(is_normalized('A')); // false
console.log(is_normalized('a')); // true