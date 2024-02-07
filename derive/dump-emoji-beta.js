import {UnicodeSpec, UnicodePrinter} from './unicode-logic.js';
import {version_ordinal} from './utils.js';

const UNICODE = new UnicodeSpec(
	new URL('./data/16.0.0/', import.meta.url), 
	new URL('./data/CLDR-44.1/', import.meta.url)
);
const PRINTER = new UnicodePrinter(UNICODE);

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

try {
	for (let info of Object.values(UNICODE.read_emoji_data()).flat()) {
		add([info.cp], info);
	}
} catch (err) {
	console.log(`no data: ${err.message}`)
}
try {
	for (let info of Object.values(UNICODE.read_emoji_seqs()).flat()) {
		add(info.cps, info);
	}
} catch (err) {
	console.log(`no seq: ${err.message}`);
}
try {
	for (let info of Object.values(UNICODE.read_emoji_zwjs()).flat()) {
		add(info.cps, info);
	}
} catch (err) {
	console.log(`no zwj: ${err.message}`);
}

for (let info of found.values()) {
	console.log(`${PRINTER.desc_for_emoji(info)} [${info.types}]`);
}
console.log(found.size);
