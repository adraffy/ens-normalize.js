// scratch file

import {inspect} from 'node:util';
import {
	ens_beautify, ens_normalize, ens_normalize_fragment, 
	ens_tokenize, ens_split, ens_emoji, 
	should_escape, is_combining_mark
} from '../src/lib.js';

function debug(x) {
	console.log(inspect(x, {depth: null, colors: true}));
}

console.log(ens_normalize(''));
console.log(ens_normalize('RAFFY.ETH'));
console.log(ens_beautify('1⃣2️⃣.eth'));
console.log(ens_emoji().length);
console.log(ens_emoji().slice(0, 3));

// readme examples
debug(ens_tokenize(''));
debug(ens_tokenize(' '));
debug(ens_tokenize('_R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./'));
debug(ens_split('💩Raffy.eth_'));
debug(ens_split('💩'));

function debug_frag(name) {
	try {
		ens_normalize(name);
	} catch (err) {
		console.log({name, frag: ens_normalize_fragment(name), error: err.message});
	}
}

debug_frag('AB--'); 
debug_frag('\u{303}');
debug_frag('οо');

console.log(should_escape(0x202E));
console.log(is_combining_mark(0x20E3));
