import {explode_cp} from '../utils.js';
import {nfd} from '../nf.js';

console.log(nfd(explode_cp('œ')));

import {join} from 'path';
import {readFileSync, writeFileSync} from 'fs';
import {read_script_sets} from '../unicode-logic.js';
import {map_values} from '../utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

let derived = JSON.parse(readFileSync(join(base_dir, '../output/v2-hr.json')));
let valid_set = new Set(derived.valid);

let scripts = map_values(read_script_sets(4), cps => cps.filter(cp => valid_set.has(cp))); 

/*

writeFileSync(join(base_dir, 'script_sets.json'), JSON.stringify({valid: [...valid_set], scripts}));
*/