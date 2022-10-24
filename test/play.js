// scratch file

import {inspect} from 'node:util';
import {ens_beautify, ens_emoji, ens_normalize, ens_tokenize, ens_split, should_escape, is_printable_mark} from '../src/lib.js';
import { str_from_cps } from '../src/utils.js';

function debug(x) {
	console.log(inspect(x, {depth: null, colors: true}));
}

console.log(ens_normalize('RAFFY.ETH'));
console.log(ens_beautify('1⃣2️⃣.eth'));
console.log(ens_emoji().length);

//debug('MabÁ︎̥̦🈚️a.eth');
//debug(String.fromCodePoint(0x31,0x309,0x307,0x31,0x307,0x309));

// readme examples
debug(ens_tokenize('_R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./'));
debug(ens_split('💩Raffy.eth_'));

console.log(should_escape(0x202E));
console.log(is_printable_mark(0x20E3));

//console.log(str_from_cps(Array(10000).fill(65)));

debug(ens_split('1️⃣Rãffy💩.eth'));