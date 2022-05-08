import {random_choice, compare_arrays, escape_unicode} from '../build/utils.js';
import {puny_encode, puny_decode} from '../build/puny.js';

// find all unicode characters
const UNICODE = [];
for (let cp = 0; cp <= 0x10FFFF; cp++) {
	try {
		String.fromCodePoint(cp);
		UNICODE.push(cp);
	} catch (err) {	
	}
}
console.log(`Found: ${UNICODE.length}`);

// generate random strings
for (let i = 0; i < 1_000_000; i++) {
	let len = (1 + Math.random() * 10)|0; // of random length
	let input = Array(len).fill(0).map(() => random_choice(UNICODE));
	let encoded = puny_encode(input);
	if (encoded === input) continue; // puny not needed
	let output = puny_decode(encoded);
	if (compare_arrays(input, output)) { 
		console.log({
			escaped: escape_unicode(String.fromCodePoint(...input)),
			input, 
			output,
			encoded, 
			puny: 'xn--' + String.fromCodePoint(...encoded)
		});
		throw new Error('wtf');
	}
}