import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import UglifyJS from 'uglify-js';

let base_dir = new URL('.', import.meta.url).pathname;

// read templated code
let code = readFileSync(join(base_dir, 'ens-normalize.js'), {encoding: 'utf8'});

// remove junk between ignore tags
code = code.replace(/\/\/\s*IGNORE.*?~IGNORE/gs, '');

// inject code
code = `import {arithmetic_decoding} from './decoder.js';\n${code}`;

// replace imports
while (true) {
	let match = code.match(/import\s+{([^}]*?)}\s+from\s+(["'])(.*?)\2.*$/m);	
	if (!match) break;
	let {['1']: names, ['3']: file} = match;
	let module = await import(file);
	let parts = [];
	if (match.index > 0) {
		parts.push(code.slice(0, match.index).trim());
	}
	for (let name of names.split(',')) {
		name = name.trim();
		if (!(name in module)) throw new Error(`unknown import: ${name} in ${file}`);		
		parts.push(`// injected from ${file}`, String(module[name]));
		console.log(`Injected code: ${name}`);
	}
	parts.push(code.slice(match.index + match[0].length).trim());
	code = parts.join('\n');
}

// read compressed tables
let compressed = readFileSync(join(base_dir, `output/arithmetic-nfc=true-bidi=true.bin`));

// inject bytes
code = code.replace('compressed()', `arithmetic_decoding(Uint8Array.from(atob('${btoa(String.fromCharCode(...compressed))}'), c => c.charCodeAt(0)))`);

// inject unicode version
let unicode_version = JSON.parse(readFileSync(join(base_dir, 'unicode-raw/version.json')));
code = `export const UNICODE = '${unicode_version.major}.${unicode_version.minor}.${unicode_version.patch}';\n${code}`;

// inject package version
let {version} = JSON.parse(readFileSync(join(base_dir, '../package.json')));
code = `export const VERSION = '${version}';\n${code}`;

// inject comments
code = `// built: ${new Date().toJSON()}\n${code}`;

// create readable source
writeFileSync(join(base_dir, `../dist/ens-normalize.js`), code);

// create minified source
writeFileSync(join(base_dir, `../dist/ens-normalize.min.js`), UglifyJS.minify(code, {
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