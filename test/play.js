import {ens_tokenize} from '../index.js';
import {inspect} from 'node:util';

function debug(s) {
	console.log(inspect(ens_tokenize(s), {depth: null, colors: true}));
}

//debug('RAFFY.eth');

//debug('MabÁ︎̥̦🈚️a.eth');

// readme example
//debug('R💩\u{FE0F}a\u{304}\u{AD}./');


//debug('🥋️꦳̝🌗️㍁𝔔');

let name = '🥋️꦳̝🌗️㍁𝔔';
console.log([...name].map(x => x.codePointAt(0)));

debug(name);