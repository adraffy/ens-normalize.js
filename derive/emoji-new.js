// find emoji that are new

import {UnicodeSpec} from './unicode-logic.js';
import {version_ordinal} from './utils.js';

const spec = new UnicodeSpec(new URL(`./data/15.0.0/`, import.meta.url));
const version0 = version_ordinal(spec.version);

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

for (let info of Object.values(spec.emoji_data()).flat()) {
	add([info.cp], info);
}
for (let info of Object.values(spec.emoji_seqs()).flat()) {
	add(info.cps, info);
}
for (let info of Object.values(spec.emoji_zwjs()).flat()) {
	add(info.cps, info);
}

for (let info of found.values()) {
	console.log(`${spec.format(info)} <${info.types}>`);
}
