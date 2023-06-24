import {hex_cp} from '../../src/utils.js';
import {safe_str_from_cps} from '../../src/lib.js';
import {UNICODE} from '../../derive/unicode-version.js';
import {writeFileSync} from 'node:fs';

export {hex_cp};

export function tt(s) {
	return `\`${s}\``;
}

export function fmt_cp(cp) {
	return tt(`${hex_cp(cp)} (${String.fromCodePoint(cp)}) ${UNICODE.get_name(cp, true)}`);
}

export function write_csv(name, recs, {form = true} = {}) {
	let cols = ['Codepoint'];
	if (form) cols.push('Form');
	cols.push('Name');
	let rows = [cols.join(',')];
	for (let rec of recs) {
		if (Number.isInteger(rec)) {
			rec = {
				cps: [rec],
				name: UNICODE.get_name(rec)	
			};
		}
		rows.push(cols.map(col => {
			switch (col) {
				case 'Codepoint': return rec.cps.map(hex_cp).join(' ');
				case 'Name': return rec.name;
				case 'Form': return safe_str_from_cps(rec.cps);
				default: throw new Error(`unknown column: ${col}`);
			}
		}).map(x => typeof x === 'string' ? `"${x}"` : x).join(','));
	}
	writeFileSync(new URL(`./${name}.csv`, import.meta.url), rows.join('\n'));
}