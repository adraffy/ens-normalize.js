import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {parse_cp_sequence, random_sample} from '../build/utils.js';
import {ens_normalize} from '../index.js';

import REGISTERED from './data/eth-labels.js';

import EMOJI_ZWJ from '../build/rules/emoji-zwj.js';
import EMOJI_ZWJ_CUSTOM from '../build/rules/emoji-zwj-custom.js';
import EMOJI_SEQ from '../build/rules/emoji-seq.js';

let base_dir = new URL('.', import.meta.url).pathname;

// get all complex emoji
// exclude from random
const EMOJI = new Set();
for (let rules of [EMOJI_ZWJ, EMOJI_ZWJ_CUSTOM, EMOJI_SEQ]) {
	for (let {src} of rules) {
		let name = String.fromCodePoint(...parse_cp_sequence(src));
		REGISTERED.delete(name);
		EMOJI.add(name);
	}
}

// get custom tests
// exclude them
const CUSTOM_TESTS = JSON.parse(readFileSync(join(base_dir, 'data/custom-tests.json')));
for (let {name} of CUSTOM_TESTS) {
	REGISTERED.delete(name);
	EMOJI.delete(name);
}

// get random tests (from gen-random-tests.js)
// exclude them
const RANDOM_NAMES = JSON.parse(readFileSync(join(base_dir, 'output/random-names.json')));
for (let name of RANDOM_NAMES) {
	REGISTERED.delete(name);
	EMOJI.delete(name);
}

// remove trivial
for (let name of REGISTERED) {
	if (/^[0-9a-z]+$/i.test(name)) {
		REGISTERED.delete(name);
	}
}

console.log(`Custom: ${CUSTOM_TESTS.length}`);
console.log(`Random: ${RANDOM_NAMES.length}`);
console.log(`Emoji: ${EMOJI.size}`);
console.log(`Registered: ${REGISTERED.size} (Non-trivial)`);

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

let emoji = process(EMOJI);
let registered = process(REGISTERED);
let random = process(RANDOM_NAMES);

for (let [k, v] of Object.entries(registered)) {
	console.log(`${k}: ${v.length}`);
}

let sample = 250;
let tests = [
	CUSTOM_TESTS,
	Object.values(emoji).flat(), 
	random_sample(registered.valid, sample),
	random_sample(registered.need_norm, sample),
	random_sample(registered.error, sample),
	Object.values(random).flat(),
].flat();

writeFileSync(join(base_dir, 'output/validation-tests.json'), JSON.stringify(tests, null, 2));