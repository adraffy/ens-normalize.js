import {join} from 'path';
import {readFileSync} from 'fs';
import {escape_unicode, tally} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

// --lib [path] (optional)
// use a different ens-normalize library (relative to invocation)
let lib_path = join(base_dir, '../index.js');

// --raw
// output raw json
let raw = false; 

// --custom
// only test custom rules
let custom = false;

let v = process.argv.slice(2);
while (v.length > 0) {
	let s = v.shift();
	if (s === '--lib') {
		lib_path = join(process.cwd(), v.shift()); 
	} else if (s === '--raw') {
		raw = true;
	} else if (s === '--custom') {
		custom = true;
	} else {
		throw new Error(`unknown arg: ${s}`);
	}
}

// validation tests
let tests = JSON.parse(readFileSync(join(base_dir, custom ? 'data' : 'output', 'validation-tests.json')));

if (!raw) {
	console.log(`Tests: ${tests.length}`);
	console.log(`Library: ${lib_path}`);
	console.log(tally(tests.map(({norm, error}) => {
		if (error) {
			return 'error';
		} else if (norm) {
			return 'need-norm';
		} else {
			return 'valid';
		}
	})));
}

let {ens_normalize} = await import(lib_path);

let errors = [];
for (let {name, norm, error, comment} of tests) {
	if (!error && norm === undefined) norm = name;
	try {
		let result = ens_normalize(name);
		if (error) {
			errors.push({type: 'expected-error', comment, name, norm, result});
		} else if (result !== norm) {
			errors.push({type: 'expected-norm', comment, name, norm, result});
		}
	} catch (err) {
		if (!error) {
			errors.push({type: 'unexpected-error', comment, name, norm, error: err.message});
		}
	}
}

if (raw) {
	console.log(JSON.stringify(errors));
} else {
	let keys = ['name', 'norm'];
	for (let x of errors) {
		for (let k of keys) {
			x[k] = escape_unicode(x[k]);
		}
	}
	if (errors.length > 0) {
		console.log(errors);
	}
	console.log(`Errors: ${errors.length}`);
}