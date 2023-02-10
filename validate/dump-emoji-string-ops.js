// these properties dont necessarily need to hold
// as system/platform unicode can vary (or might not be known: browser)
// however they are nice to have when the version is known

import {hex_seq} from '../derive/utils.js';
import {ens_emoji} from '../src/lib.js';

console.log(`Node: ${process.version} / Unicode: ${process.versions.unicode}`);
for (let emoji of ens_emoji()) {
	try {
		let form = String.fromCodePoint(...emoji);	
		if (form !== form.toLowerCase()) {
			throw 'toLowerCase';
		}
		if (form !== form.toUpperCase()) {
			throw 'toUpperCase';
		}
		if (form !== form.normalize('NFC')) {
			throw 'nfc';
		}
		if (form !== form.normalize('NFD')) {
			throw 'nfd';
		}
	} catch (err) {
		if (typeof err === 'string') {
			throw new Error(`${err} mismatch: ${hex_seq(emoji)}`);
		} else {
			throw err;
		}
	}
}

// 20230128: PASS (Node: 19.5.0 / Unicode: 15.0)
