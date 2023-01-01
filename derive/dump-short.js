import {UNICODE} from './unicode-version.js';
import {explode_cp, hex_cp} from './utils.js';

for (let info of UNICODE.char_map.values()) {
	if (info.short) {
		if (info.name.localeCompare(info.short, 'en', {sensitivity: 'base'})) {
			console.log(`${hex_cp(info.cp)} [${info.name}] [${info.short}]`);
		}
	}
}

/*
let singles = [];
let seqs = [];
for (let [form, name] of UNICODE.short_names()) {
	let cps = explode_cp(form);
	if (cps.length == 1) {
		let [cp] = cps;
		console.log(`${hex_cp(cps[0])} ${UNICODE.get_name(cp)} ${name}`);
	} else {
		console.log(`${hex_seq(cps)} (${UNICODE.safe_str(cps)}) ${name}`);
	}
}
*/
