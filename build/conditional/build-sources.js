import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import UglifyJS from 'uglify-js';
console.log(UglifyJS.default_options());

let base_dir = new URL('.', import.meta.url).pathname;

// read templated code
let code0 = readFileSync(join(base_dir, 'ens-normalize.js'), {encoding: 'utf8'});

// remove junk between ignore tags
code0 = code0.replace(/\/\/\s*IGNORE.*?~IGNORE/gs, '');

// inject unicode version
let unicode_version = JSON.parse(readFileSync(join(base_dir, 'unicode-raw/version.json')));
code0 = `export const UNICODE = '${unicode_version.major}.${unicode_version.minor}.${unicode_version.patch}';\n${code0}`;

// inject package version
let {version} = JSON.parse(readFileSync(join(base_dir, '../package.json')));
code0 = `export const VERSION = '${version}';\n${code0}`;

// inject code
code0 = `import {arithmetic_decoder} from './decoder.js';\n${code0}`;

// replace imports
while (true) {
	let match = code0.match(/import\s+{([^}]*?)}\s+from\s+(["'])(.*?)\2.*$/m);	
	if (!match) break;
	let {['1']: names, ['3']: file} = match;
	let module = await import(file);
	let parts = [];
	if (match.index > 0) {
		parts.push(code0.slice(0, match.index).trim());
	}
	for (let name of names.split(',')) {
		name = name.trim();
		if (!(name in module)) throw new Error(`unknown import: ${name} in ${file}`);		
		parts.push(`// injected from ${file}`, String(module[name]));
		console.log(`Injected code: ${name}`);
	}
	parts.push(code0.slice(match.index + match[0].length).trim());
	code0 = parts.join('\n');
}

for (let bidi of [true, false]) {
	for (let nfc of [true, false]) {
		// params
		let params = `-nfc=${nfc}-bidi=${bidi}`;
		// read compressed tables
		let compressed = readFileSync(join(base_dir, `output/arithmetic${params}.bin`));
		
		// inject bytes
		let code = code0.replace('compressed()', `arithmetic_decoder(Uint8Array.from(atob('${btoa(String.fromCharCode(...compressed))}'), c => c.charCodeAt(0)))`);
		// inject comments
		code = `// built: ${new Date().toJSON()}\n// params: ${params}\n${code}`;
		// create file
		let comp = new UglifyJS.Compressor();

		throw 1;

		let compiled = UglifyJS.minify(code, {
			compress: {
				global_defs: {
					ENABLE_NFC: nfc,
					ENABLE_BIDI: bidi
				},
				passes: 2
			},
			output: {
				beautify: true
			}
		}).code;
		writeFileSync(join(base_dir, `output/ens-normalize${params}.js`), compiled);
		writeFileSync(join(base_dir, `output/ens-normalize${params}.min.js`), UglifyJS.minify(compiled, {
			compress: {				
				toplevel: true
			},
			mangle: { 
				toplevel: true,
				properties: {
					regex: /^read/
				}
			}
		}).code);
		console.log(`Built: ${params}`);
	}
}