import {SCRIPTS} from './unicode-version.js';

function dump(v) {
	for (let abbr of v) {
		console.log(`'${abbr}', // ${SCRIPTS.require(abbr).name}`);
	}
}

console.log('// Excluded');
dump(SCRIPTS.excluded());

console.log('// Limited');
dump(SCRIPTS.limited());
