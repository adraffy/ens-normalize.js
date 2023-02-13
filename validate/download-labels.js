// download a list of registered names

import {writeFileSync, readFileSync} from 'node:fs';

let file = new URL('./labels.json', import.meta.url);

let labels = await fetch('https://raw.githubusercontent.com/adraffy/ens-labels/master/labels.json').then(r => r.json());
let before = 0;
try {
	before = JSON.parse(readFileSync(file)).length;
	console.log(`Old: ${before}`);
} catch (ignored) {	
}
console.log(`New: ${labels.length} (+${labels.length - before})`);

writeFileSync(file, JSON.stringify(labels));
