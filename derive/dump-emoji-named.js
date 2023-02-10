// find emoji whose name contains...
// eg. `node derive/dump-emoji-named.js heavy`

import {UNICODE, PRINTER} from './unicode-version.js';

let regex = new RegExp(process.argv.slice(2).join(' '), 'i');

for (let info of UNICODE.read_emoji_data().Emoji) {
	if (regex.test(info.name) || regex.test(info.name0)) {
		console.log(PRINTER.desc_for_emoji(info));
	}
}
