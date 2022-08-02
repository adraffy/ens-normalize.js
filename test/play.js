import {ens_tokenize} from '../index.js';
import {inspect} from 'node:util';

function debug(s) {
	console.log(inspect(ens_tokenize(s), {depth: null, colors: true}));
}

//debug('RAFFY.eth');

//debug('MabÁ︎̥̦🈚️a.eth');

// readme example
debug('R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./');

