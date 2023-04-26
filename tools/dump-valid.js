import {writeFileSync} from 'node:fs';
import {UNICODE} from '../derive/unicode-version.js';
import {MAX_CP, hex_cp} from '../derive/utils.js';
import {ens_tokenize, safe_str_from_cps} from '../src/lib.js';

let lines = [];
for (let cp = 0; cp <= MAX_CP; cp++) {
	if (ens_tokenize(String.fromCodePoint(cp))[0].type === 'valid') {
		let ch = UNICODE.require_char(cp);
		lines.push(`"${hex_cp(cp)}","${safe_str_from_cps([cp])}","${ch.get_name(true)}"`);
	}
}
writeFileSync(new URL('./valid.csv', import.meta.url), lines.join('\n'));
