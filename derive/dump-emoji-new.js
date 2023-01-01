// find emoji that are new

import {PRINTER, UNICODE} from './unicode-version.js';
import {version_ordinal} from './utils.js';

const version0 = version_ordinal(UNICODE.unicode_version); // version threshold

let found = new Map();
function add(cps, info) {
	if (version_ordinal(info.version) < version0) return;
	let key = String.fromCodePoint(...cps);
	let rec = found.get(key);
	if (!rec) {
		rec = {...info, types: []};
		delete rec.type;
		found.set(key, rec);
	} 
	rec.types.push(info.type);
}

for (let info of Object.values(UNICODE.read_emoji_data()).flat()) {
	add([info.cp], info);
}
for (let info of Object.values(UNICODE.read_emoji_seqs()).flat()) {
	add(info.cps, info);
}
for (let info of Object.values(UNICODE.read_emoji_zwjs()).flat()) {
	add(info.cps, info);
}

for (let info of found.values()) {
	console.log(`${PRINTER.desc_for_emoji(info)} [${info.types}]`);
}
console.log(found.size);