import {readFileSync, createReadStream} from 'fs';
import {createInterface} from 'readline/promises';

export function read_parsed(name) {
	return JSON.parse(readFileSync(new URL(`./unicode-json/${name}.json`, import.meta.url).pathname));
}

export async function parse_semicolon_file(path, impl) {
	let scope = {
		root: {},
		...impl,
		get_bucket(key) {
			if (!key) throw new Error(`empty bucket key`);
			let bucket = root[key];
			if (!bucket) bucket = root[key] = [];
			return bucket;
		} 
	};
	let {root, row, comment} = scope;
	let rl = createInterface({input: createReadStream(path)});
	for await (let line of rl) {
		let rest;
		let pos = line.indexOf('#');
		if (pos >= 0) {
			rest = line.slice(pos + 1).trim();
			line = line.slice(0, pos).trim();
		}
		if (line) {
			row?.call(scope, line.split(';').map(s => s.trim()), rest);
		} else if (rest) {
			comment?.call(scope, rest);
		}
	}
	return root;
}