// check that every character is part of the trivial "parts" set
// (performed automatically by make.js)

import {PRINTER, NF, IDNA} from './unicode-version.js';
import {readFileSync} from 'node:fs';
import {print_section } from './utils.js';

// valid from idna
//let {valid} = IDNA;

// valid from spec
let {groups} = JSON.parse(readFileSync(new URL('./output/spec.json', import.meta.url)));
let valid = new Set(groups.flatMap(g => [...g.primary, ...g.secondary]));

let tally = [];

let valid_parts = new Set([...valid, NF.nfd(valid)].flat(Infinity));
for (let cp0 of valid) {
	let parts = NF.inner_parts(cp0);
	while (tally.length <= parts.length) tally.push(0);
	tally[parts.length]++;
	if (!parts.length) continue;
	console.log(`${PRINTER.desc_for_cp(cp0)} (${parts.length})`);
	for (let cp of parts) {
		console.log(`    ${PRINTER.desc_for_cp(cp)}`);
		if (!valid_parts.has(cp)) {
			throw new Error('missing part');
		}
	}
}

console.log();
print_section('Length Distribution');
for (let i = 0; i < tally.length; i++) {
	console.log(` ${i} = ${tally[i]}`);
}

function debug(cp) {
	console.log(`  NFC: ${PRINTER.desc_for_cps(NF.nfc([cp]))}`);
	console.log(`  NFD: ${PRINTER.desc_for_cps(NF.nfd([cp]))}`);
	console.log(`Parts: ${PRINTER.desc_for_cps(NF.inner_parts(cp))}`);
}

console.log();
print_section('Known Examples');
debug(0xAC01); // hangul
debug(0x390); // greek
