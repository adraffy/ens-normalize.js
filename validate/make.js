import {readFileSync, writeFileSync} from 'node:fs';
import {UNICODE} from '../derive/unicode-version.js';
import {parse_cp_sequence} from '../derive/utils.js';
import {ens_normalize, ens_emoji, ens_beautify} from '../src/lib.js';
import {random_sample, run_tests} from '../src/utils.js';
import {read_labels, read_random, read_spec, SPEC_FILE} from './data.js';
import {createHash} from 'node:crypto';

// get custom tests
const CUSTOM_TESTS = JSON.parse(readFileSync(new URL('./custom-tests.json', import.meta.url)));

// assert no failures
let custom_errors = run_tests(ens_normalize, CUSTOM_TESTS);
if (custom_errors.length) {
	console.log(custom_errors);
	console.log(`Errors: ${custom_errors.length}`);
	throw new Error('custom');
}
console.log(`PASS custom`);

// check that every emoji exists
let emoji_map = new Map(read_spec().emoji.map(v => [String.fromCodePoint(...v), v]));
for (let cps of ens_emoji()) {
	let form = String.fromCodePoint(...cps);
	if (!emoji_map.delete(form)) {
		console.log({form, cps});
		throw new Error('missing emoji');
	}
}
if (emoji_map.size) {
	console.log(emoji_map);
	throw new Error('extra emoji');
}
console.log(`PASS ens_emoji()`);

const REQUIRE_PASS = new Set();
const REQUIRE_FAIL = new Set();
const EXPECT_PASS = new Set();
const EXPECT_FAIL = new Set();

// make tests from library
for (let cps of ens_emoji()) {
	let form = String.fromCodePoint(...cps);
	REQUIRE_PASS.add(form);
	REQUIRE_PASS.add(ens_beautify(form));
}

// make tests from rules
for (let cp of (await import('../derive/rules/chars-disallow.js')).default) {
	REQUIRE_FAIL.add(String.fromCodePoint(cp));
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
	REQUIRE_FAIL.add(String.fromCodePoint(...parse_cp_sequence(s)));
}
for (let {hex} of (await import('../derive/rules/emoji-seq-whitelist.js')).default) {
	EXPECT_PASS.add(String.fromCodePoint(...parse_cp_sequence(hex)));
}

// make tests from unicode spec
for (let cp of UNICODE.props().White_Space) {
	EXPECT_FAIL.add(String.fromCodePoint(cp));
}

// load random names
const RANDOM_NAMES = read_random();

// load registered names
const LABELS = new Set(read_labels());

// remove trivial
for (let name of LABELS) {
	if (/^[0-9a-z]+$/i.test(name)) {
		LABELS.delete(name);
	}
}
// remove generated
for (let set of [REQUIRE_PASS, REQUIRE_FAIL, EXPECT_PASS, EXPECT_FAIL]) {
	for (let x of set) {
		LABELS.delete(x);
	}
}

console.log(`Custom: ${CUSTOM_TESTS.length}`);
console.log(`Require Pass: ${REQUIRE_PASS.size}`);
console.log(`Require Fail: ${REQUIRE_FAIL.size}`);
console.log(`Expect Pass: ${EXPECT_PASS.size}`);
console.log(`Expect Fail: ${EXPECT_FAIL.size}`);
console.log(`Random: ${RANDOM_NAMES.length}`);
console.log(`Labels: ${LABELS.size} (Non-trivial)`);

// split a batch of names into groups by normalization status
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

let require_pass = process(REQUIRE_PASS);
if (require_pass.error.length) {
	console.log(require_pass);
	throw new Error('require pass');
}
let require_fail = process(REQUIRE_FAIL);
if (require_fail.valid.length || require_fail.need_norm.length) {
	console.log('Valid:', require_fail.valid);
	console.log('NeedNorm:', require_fail.need_norm);
	throw new Error('require fail');
}

// note: these are only approximate as they 
// might not account for positional-logic
let expect_pass = process(EXPECT_PASS);
if (expect_pass.error.length) {
	console.log('*** REVIEW: expected PASS ***');
	console.log(expect_pass.error);
}
let expect_fail = process(EXPECT_FAIL);
if (expect_fail.valid.length || expect_fail.need_norm.length) {
	console.log('*** REVIEW: expected FAIL ***');
	console.log('Valid:', expect_fail.valid);
	console.log('NeedNorm:', expect_fail.need_norm);
}

let registered = process(LABELS);
console.log(`Registered Distribution:`);
for (let [k, v] of Object.entries(registered)) {
	console.log(`  ${k}: ${v.length}`);
}

let spec_hash = createHash('sha256').update(readFileSync(SPEC_FILE)).digest('hex');
console.log(`Hash: ${spec_hash}`);

let sample = 2048; // arbitrary, target: ~2MB
let tests = [
	{name: 'version', created: new Date(), spec_hash},
	CUSTOM_TESTS,
	Object.values(require_pass), 
	Object.values(require_fail), 
	Object.values(expect_pass), 
	Object.values(expect_fail), 
	Object.values(registered).map(x => random_sample(x, sample)),
	Object.values(process(RANDOM_NAMES)).map(x => random_sample(x, sample)),
].flat(Infinity);

console.log(`Tests: ${tests.length}`);

writeFileSync(new URL('./tests.json', import.meta.url), JSON.stringify(tests, null, '\t'));
