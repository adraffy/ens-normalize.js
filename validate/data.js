// convenience stuff 
// since these files are all optional and/or build dependent

import {readFileSync} from 'node:fs';

export function read_labels(quiet) {
	try {
		let t = performance.now();
		let v = JSON.parse(readFileSync(new URL('./labels.json', import.meta.url)));
		if (!quiet) console.log(`Loaded ${v.length} labels in ${((performance.now() - t)/1000).toFixed(1)}s`);
		return v;
	} catch (err) {
		console.log('Missing "labels.js".  Try running `node validate/download-labels.js`');
		throw new Error('labels');
	} 
}

export function read_random() {
	try {
		return JSON.parse(readFileSync(new URL('./random-names.json', import.meta.url)));
	} catch (err) {
		console.log('Missing "random-names.json".  Try running `node validate/random-names.js`');
		throw new Error('random');
	} 
}

export function read_spec() {
	try {
		return JSON.parse(readFileSync(new URL('../derive/output/spec.json', import.meta.url)));
	} catch (err) {
		console.log('Missing "spec.json".  Try running `npm run derive`');
		throw new Error('spec');
	} 
}
