import {readFileSync} from 'fs';
import {join} from 'path';
let dir = new URL('./', import.meta.url).pathname;
export default new Set([
    // provided by nick
    readFileSync(join(dir, 'eth-labels-20211127-134810-rx6ulbdm52rz.csv'), {encoding: 'utf8'}).split('\n'),
    // provided by raffy
    JSON.parse(readFileSync(join(dir, 'eth-labels-adraffy.json')))
].flat());