import {join} from 'path';

let [_0, _1, file] = process.argv;
if (!file) throw new Error(`Expected path to an "ens_normalize.js" implementation`);
file = join(process.cwd(), file);
console.log(`Testing: ${file}`);
let lib = await import(file);

// test known examples
import {test_known} from './known.js';
let known_errors = test_known(lib.ens_normalize);
if (known_errors.length > 0) {
	console.log(known_errors);
	throw new Error('Known');
}
console.log('Known: OK');

// test emoji
import {test_emoji} from './emoji.js';
let emoji_errors = test_emoji(lib.ens_normalize);
if (emoji_errors.length > 0) {
	console.log(emoji_errors);
	throw new Error('Emoji');
}
console.log('Emoji: OK');