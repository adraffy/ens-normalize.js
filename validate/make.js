import {readFileSync, writeFileSync} from 'node:fs';
import {ens_normalize, ens_emoji} from '../src/lib.js';
import {parse_cp_sequence} from '../derive/utils.js';
import {random_sample} from '../src/utils.js';

// make tests for registered names
let LABELS;
try {
	LABELS = new Set(JSON.parse(readFileSync(new URL('./labels.json', import.meta.url))));
} catch (err) {
	console.log('Missing "labels.js".  Try running `node download-labels.js`');
	throw new Error('labels');
} 

// make tests from rules
const EXPECT_PASS = new Set();
const EXPECT_FAIL = new Set();
for (let cps of ens_emoji()) {
	EXPECT_PASS.add(String.fromCodePoint(...cps));
}
for (let cp of (await import('../derive/rules/chars-disallow.js')).default) {
	EXPECT_FAIL.add(String.fromCodePoint(cp));
}
for (let [x] of (await import('../derive/rules/chars-mapped.js')).default) {
	EXPECT_PASS.add(String.fromCodePoint(x));
}
for (let cp of (await import('../derive/rules/chars-valid.js')).default) {
	EXPECT_PASS.add(String.fromCodePoint(cp));
}
for (let cp of (await import('../derive/rules/emoji-demoted.js')).default) {
	EXPECT_PASS.add(String.fromCodePoint(cp));
}
for (let s of (await import('../derive/rules/emoji-seq-blacklist.js')).default) {
	EXPECT_FAIL.add(String.fromCodePoint(...parse_cp_sequence(s)));
}
for (let s of (await import('../derive/rules/emoji-seq-whitelist.js')).default) {
	EXPECT_PASS.add(String.fromCodePoint(...parse_cp_sequence(s)));
}

// get custom tests
const CUSTOM_TESTS = JSON.parse(readFileSync(new URL('./custom-tests.json', import.meta.url)));

// get random tests (random-tests.js)
const RANDOM_NAMES = JSON.parse(readFileSync(new URL('./random-names.json', import.meta.url)));

function disjoint(...a) {
	for (let i = 0; i < a.length; i++) {
		for (let j = i + 1; j <a.length; j++) {
			let set = a[j];
			for (let x of a[i]) {
				set.delete(x);
			}
		}
	}
}
disjoint(CUSTOM_TESTS, EXPECT_PASS, EXPECT_FAIL, LABELS);

// remove trivial
for (let name of LABELS) {
	if (/^[0-9a-z]+$/i.test(name)) {
		LABELS.delete(name);
	}
}

console.log(`Custom: ${CUSTOM_TESTS.length}`);
console.log(`Expect Pass: ${EXPECT_PASS.size}`);
console.log(`Expect Fail: ${EXPECT_FAIL.size}`);
console.log(`Random: ${RANDOM_NAMES.length}`);
console.log(`Registered: ${LABELS.size} (Non-trivial)`);

function process(names) {
	let valid = [];
	let need_norm = [];
	let error = [];
	for (let name of names) {
		try {
			let norm = ens_normalize(name);
			if (name === norm) {
				valid.push({name});
			} else {
				need_norm.push({name, norm});
			}
		} catch (err) {
			error.push({name, error: true, comment: err.message});
		}
	}
	return {valid, need_norm, error};
}

let pass = process(EXPECT_PASS);
if (pass.error.length) {
	console.log('*** REVIEW: expected PASS ***');
	console.log(pass.error);
	//throw new Error('expect pass');
}
let fail = process(EXPECT_FAIL);
if (fail.valid.length || fail.need_norm.length) {
	console.log('*** REVIEW: expected FAIL ***');
	console.log([fail.valid, fail.need_norm]);
	//throw new Error('expect fail');
}

let registered = process(LABELS);

for (let [k, v] of Object.entries(registered)) {
	console.log(`${k}: ${v.length}`);
}

let sample = 2048;
let tests = [
	CUSTOM_TESTS,
	Object.values(pass), 
	Object.values(fail), 
	Object.values(registered).map(x => random_sample(x, sample)),
	Object.values(process(RANDOM_NAMES)).map(x => random_sample(x, sample)),
].flat(Infinity);

console.log(`Tests: ${tests.length}`);

writeFileSync(new URL('./tests.json', import.meta.url), JSON.stringify(tests, null, '\t'));