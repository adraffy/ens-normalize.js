// compute the before and after scripts differences

import {readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {hex_cp, explode_cp, map_values, parse_cp_range} from '../build/utils.js';
import {read_parsed} from '../build/nodejs-utils.js';

const SCRIPTS = Object.entries(map_values(read_parsed('Scripts'), v => new Set(v.flatMap(parse_cp_range))));

function script_from_cp(cp) {
	for (let [k, v] of SCRIPTS) {
		if (v.has(cp)) {
			return k;
		}
	}
	return 'Unknown';
}

let base_dir = new URL('.', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');
mkdirSync(output_dir, {recursive: true});

function format(cp) {
	return `[${hex_cp(cp)}:${script_from_cp(cp)}]`;
}


// 1.) IDNA mapping (cp -> [cp, ...])
let {idna: {mapped: mapped_idna}} = JSON.parse(readFileSync(join(base_dir, '../build/output/idna-adraffy-hr.json')));

// 2.) NFC ([cp, ...] -> [cp, ...])
let mapped_nfc = [];
for (let cases of Object.values(JSON.parse(readFileSync(join(base_dir, '../build/unicode-json/NormalizationTest.json'))))) {
	for (let [src, nfc0] of cases) {
		src = explode_cp(src);
		if (src.length != 1) continue; // just take single char examples (90%+)
		mapped_nfc.push([src[0], explode_cp(nfc0)])
	}
}

let diffs = [];
for (let [origin, mapped] of [['IDNA', mapped_idna], ['NFC', mapped_nfc]]) {
	for (let [src, dst] of mapped) {
		let script0 = script_from_cp(src);
		let scripts = new Set(dst.map(script_from_cp));
		if (!scripts.has(script0) || scripts.size > 1) {
			//console.log({src: hex_cp(src), script0, dst: dst.map(hex_cp).join(' '), scripts});
			diffs.push({
				origin,
				src: format(src),
				dst: dst.map(format).join('')
			});
		} 
	}
}
writeFileSync(join(output_dir, 'mapped-script-diffs.json'), JSON.stringify(diffs));