// scratch file

import {inspect} from 'node:util';
import {
	ensBeautify, ensNormalize, ensNormalizeFragment, 
	ensTokenize, ensSplit, ensEmoji, 
	shouldEscape, isCombiningMark
} from '../src/lib.js';

function debug(x) {
	console.log(inspect(x, {depth: null, colors: true}));
}

console.log(ensNormalize(''));
console.log(ensNormalize('RAFFY.ETH'));
console.log(ensBeautify('1⃣2️⃣.eth'));
console.log(ensEmoji().length);
console.log(ensEmoji().slice(0, 3));

// readme examples
debug(ensTokenize(''));
debug(ensTokenize(' '));
debug(ensTokenize('_R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./'));
debug(ensSplit('💩Raffy.eth_'));
debug(ensSplit('💩'));

function debug_frag(name) {
	try {
		ensNormalize(name);
	} catch (err) {
		console.log({name, frag: ensNormalizeFragment(name), error: err.message});
	}
}

debug_frag('AB--'); 
debug_frag('\u{303}');
debug_frag('οо');

console.log(shouldEscape(0x202E));
console.log(isCombiningMark(0x20E3));
