import {UNICODE} from '../unicode-version.js';
import {readFileSync} from 'node:fs';


console.log(UNICODE.allowed_identifiers().length);

console.log(Object.entries(UNICODE.identifier_types()).map(([name, cps]) => [name, cps.length]));


// dogfood: valid
let valid = new Set(JSON.parse(readFileSync(new URL('../output/spec.json', import.meta.url))).valid);

let filter = new Set(); //new Set(UNICODE.allowed_identifiers());

for (let [key, cps] of Object.entries(UNICODE.identifier_types())) {
	if (key.includes('Obsolete')) { // Not_XID
		for (let cp of cps) {
			filter.add(cp);
		}
	}
}


let found = 0;
for (let cp of valid) {
	if (filter.has(cp)) {
		console.log(UNICODE.js_format(cp));
		found++;
	}
}
console.log(filter.size, found);
