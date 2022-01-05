
/*
import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
let base_dir = new URL('.', import.meta.url).pathname;
let tests = JSON.parse(readFileSync(join(base_dir, '../build/unicode-json/emoji-test.json')));
let emoji = [];
for (let [k, list] of Object.entries(tests)) {
	for (let {codes} of list) {
		emoji.push({input: codes, type: k});
	}
}
writeFileSync(join(base_dir, 'data/emoji-20211212.json'), JSON.stringify(emoji, null, '  '));
*/

import {readFileSync} from 'fs';
import {join} from 'path';
import {parse_cp_sequence} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let tests = JSON.parse(readFileSync(join(base_dir, 'data/emoji-20220104.json')));

export function test_emoji(ens_normalize) {
	let errors = [];
	for (let {input, norm, error} of tests) {
		try {
			let name = String.fromCodePoint(...parse_cp_sequence(input));
			norm = norm ? String.fromCodePoint(...parse_cp_sequence(norm)) : name;
			let result = ens_normalize(name);
			if (error) {
				errors.push({type: 'expected-error', input, error, result});
			}
			if (result !== norm) {
				errors.push({type: 'diff', input, norm, result});
			}
		} catch (err) {
			if (!error) {
				errors.push({type: 'unexpected-error', input, error: err.message});
			}
			// TODO: confirm form (no FE0F)
		}
	}
	return errors;
}
