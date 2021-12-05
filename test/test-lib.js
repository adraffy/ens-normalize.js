import {join} from 'path';

let [_0, _1, file] = process.argv;
if (!file) throw new Error(`Expected path to an "ens_normalize.js" implementation`);
file = join(process.cwd(), file);
console.log(`Testing: ${file}`);
let module = await import(file);

// test known examples
import {test_known} from './test-known.js';
test_known(module.ens_normalize);