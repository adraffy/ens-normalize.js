// download a list of registered names

import {writeFileSync} from 'node:fs';

async function fetch_json(url) {
	let res = await fetch(url);
	if (res.status !== 200) throw new Error(`HTTP Error ${res.status}`);
	return res.json();
}

let labels = [...new Set((await Promise.all([
	fetch_json('https://raw.githubusercontent.com/adraffy/ens-norm-tests/main/eth-labels/registered.json'),
	fetch_json('https://raw.githubusercontent.com/adraffy/ens-norm-tests/main/eth-labels/reverse.json')
])).flat().flatMap(s => s.split('.')))].sort((a, b) => a.localeCompare(b));

console.log(labels.length);

writeFileSync(new URL('./labels.json', import.meta.url), JSON.stringify(labels));
