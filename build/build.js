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

let BUILD_TIME = new Date().toJSON();

function inject_name_versions(code, name, version) { //, debug) {
	if (version) {
		// include version variables
		code = [
			`export const BUILT = '${BUILD_TIME}';`,
			`export const UNICODE = '${unicode_version.major}.${unicode_version.minor}.${unicode_version.patch}';`,
			`export const VERSION = '${package_version}';`,
			`export const NAME = '${name}';`,
			code
		].join('\n');
	} else {
		code = `// built: ${BUILD_TIME}\n${code}`;
	}
	/*
	if (debug) {
		debug = readFileSync(join(base_dir, 'debug-includes.js'), {encoding: 'utf8'});
		code = `${code}\n// *** DEBUG ***\n${debug}`;
	}
	*/
	return code;
}

function generate_release_lib({name, file = 'lib-normalize-release.js', versions = false}) {
	let code = readFileSync(join(base_dir, file), {encoding: 'utf8'});
	code = inject_name_versions(code, name, versions);
	writeFileSync(tmp_file, code);
	return tmp_file;
}

function generate_dev_lib({rules, nfc = true, bidi = true, context = true}) {
	let code = readFileSync(join(base_dir, 'lib-normalize-dev.js'), {encoding: 'utf8'});
	// change version of idna (from default)
	// this should match import statement	
	code = code.replace(/(output\/rules-).*(\.js)/m, (_, a, b) => a + rules + b);
	if (!nfc) {
		// swap to String.normalize()
		code = code.replace('./nf.js', './nf0.js'); 
	}
	if (!bidi) {
		// remove bidi blocks
		code = code.replaceAll(/\/\*BIDI\*\/(.*?)\/\*~BIDI\*\//smg, '');
	}
	if (!context) {
		// remove context blocks
		code = code.replaceAll(/\/\*CONTEXT\*\/(.*?)\/\*~CONTEXT\*\//smg, '');
	}
	code = inject_name_versions(code, rules, true);
	writeFileSync(tmp_file, code);
	return tmp_file;
}


// build release
await build(generate_release_lib({name: 'adraffy'}), 'ens-normalize');
await build(generate_release_lib({name: 'adraffy', versions: true}), 'ens-normalize-debug');

// build dev variants
/*
let rules = 'adraffy';
let prefix = `ens-normalize-`;
await build(generate_lib({rules}), `${prefix}-adraffy`);
await build(generate_lib({rules, bidi: false}), `${prefix}-adraffy-xbidi`);
await build(generate_lib({rules, nfc: false}), `${prefix}-adraffy-xnfc`);
await build(generate_lib({rules, bidi: false, nfc: false}), `${prefix}-adraffy-xnfc-xbidi`);
await build(generate_lib({rules: 'adraffy-exp'}), `${prefix}-adraffy-exp`);
await build(generate_lib({rules: 'adraffy-compat'}), `${prefix}-adraffy-compat`);
*/

// build alt versions
await build(generate_dev_lib({rules: '2003'}), `ens-normalize-2003`);
await build(generate_dev_lib({rules: '2008'}), `ens-normalize-2008`);
await build(generate_dev_lib({rules: 'UTS46'}), `ens-normalize-UTS46`);
await build(generate_dev_lib({rules: 'UTS51'}), `ens-normalize-UTS51`);
await build(generate_dev_lib({rules: 'ENS0', context: false, bidi: false, nfc: false}), `ens-normalize-ENS0`);

// build sub-libraries
await build(join(base_dir, 'lib-nf.js'), 'nf');
await build(join(base_dir, 'lib-bidi.js'), 'bidi');
await build(join(base_dir, 'lib-parts.js'), 'parts');
await build(join(base_dir, 'lib-dns.js'), 'dns');

// compute compression overhead
// as of 20220115: ~2KB
// await build(join(base_dir, 'lib-overhead.js'), 'overhead');

try {
	unlinkSync(tmp_file);
} catch (ignored) {	
}

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
				passes: 1, 
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
	/*
	// why the fuck is this stuff so dumb?
	await bundle.write({
		file: join(dist_dir, `${dist_name}.umd.min.js`),
		format: 'umd',
		name: 'adraffy',
		plugins: [terser({
			compress: {
				toplevel: true,
				passes: 1, 
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
	*/
	await bundle.close();
	console.log(`Built: ${dist_name}`);
}



