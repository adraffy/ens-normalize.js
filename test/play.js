import {ens_beautify, ens_normalize, ens_tokenize} from '../index.js';
import {inspect} from 'node:util';

function debug(s) {
	console.log(inspect(ens_tokenize(s), {depth: null, colors: true}));
}

console.log(ens_normalize('RAFFY.ETH'));

console.log(ens_beautify('1⃣2️⃣.eth'));

//debug('MabÁ︎̥̦🈚️a.eth');

// readme example
debug('R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./');