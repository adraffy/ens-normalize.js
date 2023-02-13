// check unicode emoji conformance
// this is not part of the validation process
// as it is effectively guaranteed by validate.js

import {UNICODE, PRINTER} from '../derive/unicode-version.js';
import {explode_cp, hex_seq, print_section} from '../derive/utils.js';
import {ens_beautify, ens_normalize, ens_tokenize} from '../src/lib.js';

let errors = [];
let expected = [];
let type_tally = {};

// [known types]
// 'fully-qualified'     :: https://unicode.org/reports/tr51/#def_fully_qualified_emoji
// 'minimally-qualified' :: https://unicode.org/reports/tr51/#def_minimally_qualified_emoji
// 'unqualified'         :: https://unicode.org/reports/tr51/#def_unqualified_emoji
// 'component'           :: "an Emoji_Component, excluding Regional_Indicators, ASCII, and non-Emoji."

for (let test of UNICODE.read_emoji_test()) {
	type_tally[test.type] = (type_tally[test.type]|0) + 1;
	let form = String.fromCodePoint(...test.cps);
	try {
		let norm = ens_normalize(form);
		if (test.type === 'fully-qualified') {
			let nice = ens_beautify(norm);
			if (nice !== form) {
				// might be forced emoji style
				// (we put a FE0F on the end but it's not the default)
				let nice_cps = explode_cp(nice);
				if (nice_cps[nice_cps.length-1] === 0xFE0F && ens_beautify(String.fromCodePoint(nice_cps.slice(0, -1)))) {
					console.log(`Forced Emoji Presentation: ${form} ${hex_seq(test.cps)} => ${hex_seq(nice_cps)}`);
					continue;
				}
				// might be idna mapped
				let [token] = ens_tokenize(form);
				if (token.type === 'mapped') {
					expected.push(`IDNA Mapped: ${PRINTER.desc_for_mapped(token.cp, token.cps)}`);
					continue;
				}
				// TODO: remove expected failures 
				// see: derive/rules/emoji.js => EMOJI_DISABLED, EMOJI_SEQ_BLACKLIST
				throw new Error('wtf');
			}
		}
	} catch (err) {
		errors.push({form, error: err.message, ...test});
	}
}

console.log();
print_section(`Expected (${expected.length})`);
expected.forEach(x => console.log(x));


console.log();
print_section(`Errors (${errors.length})`);
for (let x of errors) {
	console.log(`[${x.group}/${x.subgroup}] ${x.form} ${hex_seq(x.cps)}: ${x.error}`);
}

console.log();
console.log(type_tally);

// 20230118: PASS v1.8.6 (errors for skin color, "‼️", and "⁉️")
// 20230112: PASS v1.9.10 (same)
