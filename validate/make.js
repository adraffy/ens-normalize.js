import {readFileSync, writeFileSync} from 'node:fs';
import {UNICODE} from '../derive/unicode-version.js';
import {parse_cp_sequence, mulberry32, print_section, print_checked} from '../derive/utils.js';
import {ens_normalize, ens_emoji, ens_beautify, ens_split} from '../src/lib.js';
import {random_sample, run_tests} from '../src/utils.js';
import {read_labels, read_random, read_spec} from './data.js';
import * as versions from '../src/include-versions.js';

// get custom tests
const CUSTOM_TESTS = JSON.parse(readFileSync(new URL('./custom-tests.json', import.meta.url)));

// get spec
const SPEC = read_spec();

// assert no failures
let custom_errors = run_tests(ens_normalize, CUSTOM_TESTS);
if (custom_errors.length) {
	console.log(custom_errors);
	console.log(`Errors: ${custom_errors.length}`);
	throw new Error('custom');
}
console.log(`PASS custom`);

// check that every emoji exists
let emoji_map = new Map(SPEC.emoji.map(v => [String.fromCodePoint(...v), v]));
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
const EXPECT_IGNORED = new Set();

// make tests from library
for (let cps of ens_emoji()) {
	let form = String.fromCodePoint(...cps);	
	// qualified forms 
	// (these should be the same)
	REQUIRE_PASS.add(form); 
	REQUIRE_PASS.add(ens_beautify(form));
	// 20230119: generate every combination of FE0F's
	// (no change in validation results)
	cps.reduce((a, cp) => {
		let b = a.map(v => [...v, cp]);
		return cp == 0xFE0F ? [...a, ...b] : b;
	}, [[]]).forEach(v => REQUIRE_PASS.add(String.fromCodePoint(...v)));
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
import {EMOJI_DEMOTED, EMOJI_DISABLED, EMOJI_SEQ_BLACKLIST, EMOJI_SEQ_WHITELIST} from '../derive/rules/emoji.js';
for (let cp of EMOJI_DEMOTED) {
	EXPECT_PASS.add(String.fromCodePoint(cp));
}
for (let cp of EMOJI_DISABLED) {
	REQUIRE_FAIL.add(String.fromCodePoint(cp));
}
for (let hex of EMOJI_SEQ_BLACKLIST) {
	REQUIRE_FAIL.add(String.fromCodePoint(...parse_cp_sequence(hex)));
}
for (let {hex} of EMOJI_SEQ_WHITELIST) {
	EXPECT_PASS.add(String.fromCodePoint(...parse_cp_sequence(hex)));
}

// make tests from unicode spec
let props = UNICODE.read_props();
for (let prop of ['White_Space', 'Noncharacter_Code_Point', 'Pattern_White_Space', 'Sentence_Terminal']) { 
	for (let cp of props[prop]) {
		EXPECT_FAIL.add(String.fromCodePoint(cp));
	}
}
for (let prop of ['Variation_Selector']) {
	for (let cp of props[prop]) {
		EXPECT_IGNORED.add(String.fromCodePoint(cp));
	}
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

print_section('Summary');
console.log(`Custom: ${CUSTOM_TESTS.length}`);
console.log(`Require Pass: ${REQUIRE_PASS.size}`);
console.log(`Require Fail: ${REQUIRE_FAIL.size}`);
console.log(`Expect Pass: ${EXPECT_PASS.size}`);
console.log(`Expect Fail: ${EXPECT_FAIL.size}`);
console.log(`Expect Ignored: ${EXPECT_IGNORED.size}`);
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

print_section('Check Required');

let require_pass = process(REQUIRE_PASS);
if (require_pass.error.length) {
	console.log(require_pass);
	throw new Error('require pass');
}
print_checked('Pass');

let require_fail = process(REQUIRE_FAIL);
if (require_fail.valid.length || require_fail.need_norm.length) {
	console.log('Valid:', require_fail.valid);
	console.log('NeedNorm:', require_fail.need_norm);
	throw new Error('require fail');
}
print_checked('Fail');


// note: these are only approximate as they 
// might not account for positional-logic
let expect_pass = process(EXPECT_PASS);
if (expect_pass.error.length) {
	print_section('REVIEW: expected PASS');
	console.log(expect_pass.error);
}

let expect_fail = process(EXPECT_FAIL);
if (expect_fail.valid.length) {
	print_section('REVIEW: VALID expected FAIL');
	console.log(expect_fail.valid);
}
if (expect_fail.need_norm.length) {
	print_section('REVIEW: NORMED expected FAIL');
	console.log(expect_fail.need_norm);
}
let expect_ignore = [];
for (let name of EXPECT_IGNORED) {
	// 20220121: null labels are now invalid
	/*
	try {
		let norm = ens_normalize(name);
		if (norm.length) {
			expect_ignore.push({name});
		}
	} catch (err) {
		expect_ignore.push(name, err);
	}
	*/
	if (ens_split(name).some(x => !x.tokens || x.tokens.length)) { // failed to parse or !empty
		expect_ignore.push({name});
	}
}
if (expect_ignore.length) {
	print_section(`REVIEW: expected IGNORED`);
	console.log(expect_ignore);
}

let registered = process(LABELS);
print_section(`Registered Distribution`);
for (let [k, v] of Object.entries(registered)) {
	console.log(`  ${k}: ${v.length}`);
}

// use seeded rng so git diff is useful
let rng = mulberry32(0x2EC4373F); 

// number of tests to generate (arbitrary)
// 20230211: changed from 2048 (target 2MB)
let sample = 5000; 
let tests = [
	{name: 'version', validated: new Date(), ...versions},
	CUSTOM_TESTS,
	Object.values(require_pass), 
	Object.values(require_fail), 
	Object.values(expect_pass), 
	Object.values(expect_fail), 
	Object.values(registered).map(x => random_sample(x, sample, rng)),
	Object.values(process(RANDOM_NAMES)).map(x => random_sample(x, sample, rng)),
].flat(Infinity);

print_section(`Write Output`);
writeFileSync(new URL('./tests.json', import.meta.url), JSON.stringify(tests, null, '\t'));
console.log(`Tests: ${tests.length}`);