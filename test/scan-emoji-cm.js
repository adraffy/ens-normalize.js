import REGISTERED from './data/eth-labels.js';
import {read_combining_marks, read_emoji_data} from '../build/unicode-logic.js';
import {explode_cp, split_between, hex_cp, escape_unicode } from '../build/utils.js';
import {nfd} from '../build/nf.js';

import {writeFileSync} from 'fs';
import {join} from 'path';

let base_dir = new URL('.', import.meta.url).pathname;

let emoji = new Set(read_emoji_data().Emoji);
for (let i = 0; i < 10; i++) {
	emoji.delete(0x30+i);
}

let cm = read_combining_marks();
cm.delete(0x20E3);
cm.delete(0xFE0F);
cm.delete(0xFE0E);

for (let name of REGISTERED) {
	//let cps = explode_cp(name).map(cp => [cp, cm.has(cp)]);
	//let m = split_between(cps, (_, [__, cm]) => !cm);

	let cps = nfd(explode_cp(name));

	for (let i = 0; i < cps.length - 1; i++) {
		if (emoji.has(cps[i]) && cm.has(cps[i+1])) {
			console.log({i, name});
			console.log(escape_unicode(String.fromCodePoint(...cps)));
			console.log();
		}
	}
}
