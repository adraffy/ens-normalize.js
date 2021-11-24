// confirm that every zwnj emoji post idna 
// simply strips 200D and F0EF

import {idna} from '../ens-normalize.js';
import {readFile} from 'fs/promises';

let list = JSON.parse(await readFile('./emoji-zwnj.json'));

let REGEX_STRIP = /(\u200D|\uFE0F)/gu;

for (let i = 0; i < list.length; i++) {
	let emoji = list[i];
	let a = idna(emoji);
	let b = emoji.replaceAll(REGEX_STRIP, ''); //.normalize('NFC');
	if (a != b) {
		throw {i, emoji, a, b};
	}	
}

console.log('aww yiss');