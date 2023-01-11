// scratch file

import {inspect} from 'node:util';
import {ens_beautify, ens_emoji, ens_normalize, ens_tokenize, ens_split, should_escape, is_combining_mark} from '../src/lib.js';

function debug(x) {
	console.log(inspect(x, {depth: null, colors: true}));
}

console.log(ens_normalize('RAFFY.ETH'));
console.log(ens_beautify('1⃣2️⃣.eth'));
console.log(ens_emoji().length);

// readme examples
debug(ens_tokenize('_R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./'));
debug(ens_split('💩Raffy.eth_'));

console.log(should_escape(0x202E));
console.log(is_combining_mark(0x20E3));
