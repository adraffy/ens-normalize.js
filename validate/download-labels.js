// download a list of registered names

import {writeFileSync, readFileSync} from 'node:fs';

async function fetch_json(url) {
	let res = await fetch(url);
	if (res.status !== 200) throw new Error(`HTTP Error ${res.status}`);
	return res.json();
}

let file = new URL('./labels.json', import.meta.url);

let labels = [...new Set((await Promise.all([
	fetch_json('https://raw.githubusercontent.com/adraffy/ens-labels/master/registered.json'),
	fetch_json('https://raw.githubusercontent.com/adraffy/ens-labels/master/reverse.json')
])).flat().flatMap(s => s.split('.')))].sort((a, b) => a.localeCompare(b));

let before = 0;
try {
	before = JSON.parse(readFileSync(file)).length;
	console.log(`Old: ${before}`);
} catch (ignored) {	
}
console.log(`New: ${labels.length} (+${labels.length - before})`);

writeFileSync(file, JSON.stringify(labels));

