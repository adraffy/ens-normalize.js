import {UNICODE, NF, IDNA, PRINTER} from './unicode-version.js';
import {compare_arrays, hex_cp} from './utils.js';

let confusables = UNICODE.confusables();
let valid_set = new Set(IDNA.valid);

// check that there are no duplicates
let union = new Set();
for (let [_, cps] of confusables) {
	for (let cp of cps) {
		if (union.has(cp)) {
			throw new Error(`Duplicate: ${PRINTER.desc_for_cp(cp)}`);
		}
		union.add(cp);
	}
}

const MARKER = 'primary';

PRINTER.js_header();
console.log(`function ${MARKER}(cp) { return {cp, type: 'primary'}; }`);
console.log(`function single(cp) { return {cp, type: 'single'}; }`);
console.log(`export default [`);
for (let [target, cps] of confusables) {
	let nfc = NF.nfc(target);
	let nfd = NF.nfd(target);
	let same_nfc = !compare_arrays(target, nfc);
	let same_nfd = !compare_arrays(target, nfd);
	let sameness;
	if (same_nfc !== same_nfd) {
		sameness = `NFC(${same_nfc}) NFD(${same_nfd})`;
	} else if (same_nfc) {
		sameness = 'Same';
	} else {
		sameness = `NF(false)`;
	}
	console.log('\t[');
	console.log(`\t\t// "${UNICODE.safe_str(nfc)}" <${sameness}>`);
	console.log(`\t\t'${target.map(cp => hex_cp(cp)).join(' ')}', // ${PRINTER.names(target)} ${format_set(UNICODE.get_script_set(target))}=>${format_set(UNICODE.get_resolved_script_set(target))}`);
	if (target.length === 1) {
		cps.unshift(target[0]);
	}
	let ascii = cps.filter(x => x < 0x80);
	for (let cp of cps) {
		let desc = `0x${hex_cp(cp)}`;
		if (ascii.length == 1 && ascii[0] === cp) {
			desc = `${MARKER}(${desc})`;
		}
		desc = `${desc}, // (${UNICODE.get_display(cp)}) ${UNICODE.get_name(cp)}`;
		if (!valid_set.has(cp)) {
			desc = `//IDNA:${desc}`;
		}
		desc = `${desc} ${format_set(UNICODE.get_script_set(cp))}=>${format_set(UNICODE.get_resolved_script_set(cp))}`;
		console.log(`\t\t${desc}`);
	}
	console.log('\t],');
}
console.log(`]`);

function format_set(set) {
	return `[${[...set].join(',')}]`;
}
