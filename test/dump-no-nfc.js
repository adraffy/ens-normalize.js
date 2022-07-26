import {all_codepoints, read_combining_marks} from '../build/unicode-logic.js';
import {compare_arrays} from '../build/utils.js';
import {nfd} from '../build/nf.js';
import {writeFile} from 'node:fs/promises';

let cm = [...read_combining_marks()];
let comp = all_codepoints().filter(cp => compare_arrays(nfd([cp]), [cp]) != 0);

await writeFile(new URL('./output/no-nfc.json', import.meta.url), JSON.stringify({cm, comp}));