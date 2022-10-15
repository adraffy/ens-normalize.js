import {read_wholes} from '../wholes.js';
import {SCRIPTS} from '../unicode-version.js';

for (let script of await read_wholes(SCRIPTS, () => true)) {
	console.log(script.abbr, script.wholes.size);
}