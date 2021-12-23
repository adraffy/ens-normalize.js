import {rollup} from 'rollup';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import {terser} from 'rollup-plugin-terser';
import {join, resolve} from 'path';
import {readFileSync, writeFileSync, unlinkSync} from 'fs';

let base_dir = new URL('.', import.meta.url).pathname;
let dist_dir = resolve(base_dir, '../dist');
let tmp_file = join(base_dir, '.tmp.js'); // this needs to be in this directory

let unicode_version = JSON.parse(readFileSync(join(base_dir, 'unicode-raw/version.json')));
let {version: package_version} = JSON.parse(readFileSync(join(base_dir, '../package.json')));

let BUILD_TIME = `// built: ${new Date().toJSON()}`;

let VERSIONS = `export const UNICODE = '${unicode_version.major}.${unicode_version.minor}.${unicode_version.patch}';
export const VERSION = '${package_version}';`

function add_version(file) {
	let code = readFileSync(file, {encoding: 'utf8'});
	writeFileSync(tmp_file, `${BUILD_TIME}
export const UNICODE = '${unicode_version.major}.${unicode_version.minor}.${unicode_version.patch}';
export const VERSION = '${package_version}';
export const IDNA = '${package_version}';
//
${code}`);
	return tmp_file;
}

function generate_lib({idna, nfc = true, bidi = true}) {
	let code = readFileSync(join(base_dir, 'lib-normalize.js'), {encoding: 'utf8'});
	// change version of idna (from default)
	code = code.replace(/(output\/idna)\-*.(\.js)/, (_, a, b) => a+idna+b);
	if (!nfc) {
		// swap to String.normalize()
		code = code.replace('./nf.js', './nf0.js'); 
	}
	if (!bidi) {
		// remove bidi blocks
		code = code.replaceAll(/\/\*BIDI\*\/(.*?)\/\*~BIDI\*\//smg, '');
	}
	writeFileSync(tmp_file, `${BUILD_TIME}\n${code}`);
	return tmp_file;
}

// build libraries
let idna = 'adraffy';
await build(generate_lib({idna}), 'ens-normalize');
await build(generate_lib({idna, bidi: false}), 'ens-normalize-xbidi');
await build(generate_lib({idna, nfc: false}), 'ens-normalize-xnfc');
await build(generate_lib({idna, bidi: false, nfc: false}), 'ens-normalize-xnfc-xbidi');

// build debug library with everything
await build(add_version(join(base_dir, 'lib-debug.js')), 'ens-normalize-debug');

// build alt versions
for (let x of ['2003', '2008', 'ens-genesis']) {
	await build(generate_lib({idna: x}), `ens-normalize-${x}`);
}

// build sub-libraries
await build(join(base_dir, 'lib-nf.js'), 'nf');
await build(join(base_dir, 'lib-bidi.js'), 'bidi');

unlinkSync(tmp_file);

async function build(lib_file, dist_name) {
	let bundle = await rollup({
		input: lib_file,
		plugins: [nodeResolve()]
	});
	await bundle.write({
		file: join(dist_dir, `${dist_name}.js`),
		format: 'es'
	});	
	await bundle.write({
		file: join(dist_dir, `${dist_name}.min.js`),
		format: 'es',
		plugins: [terser({
			compress: {
				toplevel: true,
				passes: 2,
				dead_code: true
			},
			mangle: { 
				toplevel: true,
				properties: {
					regex: /^read/
				}
			}
		})]
	});
	await bundle.close();
	console.log(`Built: ${dist_name}`);
}



