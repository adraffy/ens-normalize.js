import {join} from 'path';
import {readFileSync, writeFileSync} from 'fs';
import {read_parsed} from '../nodejs-utils.js';
import {read_script_sets} from '../unicode-logic.js';
import {map_values, parse_cp_sequence, date_str, hex_cp} from '../utils.js';
import {nfc} from '../nf.js';

let base_dir = new URL('.', import.meta.url).pathname;

let derived = JSON.parse(readFileSync(join(base_dir, '../output/v2-hr.json')));
let valid_set = new Set(derived.valid);

let {ALL, ...scripts} = map_values(read_script_sets(), cps => new Set(cps.filter(cp => valid_set.has(cp)))); 


Object.entries(scripts).map(([script0, set0]) => {

	for (let [script, set] of Object.entries(scripts)) {
		for (let cp of set0) {
			
		}
	}

});


