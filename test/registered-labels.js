import {readFileSync} from 'fs';
import {join} from 'path';

let data_dir = new URL('./data/', import.meta.url).pathname;

// provided by nick
export const BEFORE = new Set(readFileSync(join(data_dir, 'eth-labels-20211127-134810-rx6ulbdm52rz.csv'), {encoding: 'utf8'}).split('\n'));

// provided by adraffy
export const AFTER = new Set(JSON.parse(readFileSync(join(data_dir, 'eth-labels-adraffy.json'))));

// combine together
// note: this is a Set
export default new Set([...BEFORE, ...AFTER]);