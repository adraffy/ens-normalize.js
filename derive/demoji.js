// find emoji that were mapped by IDNA 2003 

import {UnicodeSpec} from './unicode-logic.js';
import {hex_cp} from './utils.js';

const VERSION = `15.0.0`;
const spec = new UnicodeSpec(new URL(`./data/${VERSION}/`, import.meta.url));
const idna = spec.idna_rules({version: 2003, use_STD3: true, valid_deviations: true});
const is_mapped = new Set(idna.mapped.map(x => x[0]));

for (let info of spec.emoji_data().Emoji) {
	if (is_mapped.has(info.cp)) {
		console.log(`0x${hex_cp(info.cp)}, // (${String.fromCodePoint(info.cp)}) ${info.name}`);
	}
}
