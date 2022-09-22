// scratch file

import {inspect} from 'node:util';
import {ens_beautify, ens_emoji, ens_normalize, ens_tokenize} from '../src/lib.js';

function debug(s) {
	console.log(inspect(ens_tokenize(s), {depth: null, colors: true}));
}

console.log(ens_normalize('RAFFY.ETH'));

console.log(ens_beautify('1⃣2️⃣.eth'));

console.log(ens_emoji().length);

//debug('MabÁ︎̥̦🈚️a.eth');
//debug(String.fromCodePoint(0x31,0x309,0x307,0x31,0x307,0x309));

// readme example
debug('_R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./');
