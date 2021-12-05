
import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {recursive_encoder} from './utils.js';
import {decode2} from './decoder.js';
import {encode2} from './encoder.js';

let base_dir = new URL('.', import.meta.url).pathname;

// read templated code
let code = readFileSync(join(base_dir, 'ens-normalize.js'), {encoding: 'utf8'});

// read compress tables
let {date, version: unicode_version, max_width, ...tables} = JSON.parse(readFileSync(join(base_dir, 'tables-json/compressed.json')));

// remove junk between ignore tags
code = code.replace(/\/\/\s*IGNORE.*?~IGNORE/gs, '');

// replace imports
while (true) {
	let match = code.match(/import\s+{([^}]+?)}\s+from\s+'([^']+?)';/);
	if (!match) break;
	let file = match[2];
	let module = await import(file);
	let parts = [];
	if (match.index > 0) {
		parts.push(code.slice(0, match.index).trim());
	}
	for (let name of match[1].split(',')) {
		name = name.trim();
		if (!(name in module)) throw new Error(`unknown import: ${name} in ${file}`);		
		parts.push(`// injected from ${file}`, String(module[name]));
		console.log(`Injected code: ${name}`);
	}
	parts.push(code.slice(match.index + match[0].length).trim());
	code = parts.join('\n');
}

function base64_from_bytes(v) {
	return btoa(String.fromCharCode(...v)); 
}
function bytes_from_base64(s) {
	return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

// inject decoder functions
for (let fn of [decode2, bytes_from_base64]) {
	code = `// injected from ./build-source.js\n${fn}\n${code}`;
}

// expand mapped placeholder into individual tables
let mapped = [];
for (let i = 1; i <= max_width; i++) mapped.push(`decompress('M${i}')`);
code = code.replace(`decompress_mapped()`, `[${mapped.join(',')}]`); 

// replace individual tables
// note: this only matches single-quotes
code = code.replace(/decompress\('(.*?)'\)/gs, (_, key) => {
	let v0 = tables[key];
	if (!Array.isArray(v0)) throw new Error(`unknown table: ${key}`);
	delete tables[key]; 
	let {v, n} = recursive_encoder(encode2, v0);
	let s = `bytes_from_base64('${base64_from_bytes(v)}')`;
	for (let i = 0; i < n; i++) s = `decode2(${s})`;
	console.log(`Injected table: ${key} [${v0.length} => ${v.length}]^${n} ${100 * v.length / v0.length | 0}%`);
	return s;
});

if (Object.keys(tables).length > 0) {
	throw new Error('not all tables injected');
}

// inject unicode version
code = `export const UNICODE_VERSION = '${unicode_version.major}.${unicode_version.minor}.${unicode_version.patch}';\n${code}`;

// inject package version
let {version} = JSON.parse(readFileSync(join(base_dir, '../package.json')));
code = `export const VERSION = '${version}';\n${code}`;

// output code
writeFileSync(join(base_dir, '../dist/ens-normalize.js'), code);