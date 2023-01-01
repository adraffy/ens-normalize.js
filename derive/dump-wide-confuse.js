import {UNICODE, NF, PRINTER} from './unicode-version.js';

let confusables = UNICODE.read_confusables();

for (let [target, cps] of confusables) {
	if (target.every(cp => UNICODE.cm.has(cp))) continue;
	if (NF.nfc(target).length < 2) continue;
	console.log(PRINTER.desc_for_cps(target));
}
