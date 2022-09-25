import {readFileSync} from 'node:fs';

export function read_labels() {
	try {
		return JSON.parse(readFileSync(new URL('./labels.json', import.meta.url)));
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

export const SPEC_FILE = new URL('../derive/output/spec.json', import.meta.url);

export function read_spec() {
	try {
		return JSON.parse(readFileSync(SPEC_FILE));
	} catch (err) {
		console.log('Missing "spec.json".  Try running `npm run derive`');
		throw new Error('spec');
	} 
}
