import {readFileSync} from 'fs';

export function read_parsed(name) {
	return JSON.parse(readFileSync(new URL(`./unicode-json/${name}.json`, import.meta.url).pathname));
}