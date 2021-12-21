import {escape_unicode} from '../build/utils.js';

export const KNOWN = [
	// pass
	{name: "bRAnTlY.eTh", norm: "brantly.eth"}, 

	// fail
	{name: "🧞\u200c\u200c.eth", norm: "🧞", error: true},

	// puny-code
	{name: "xn--ls8h.eth", norm: "💩.eth"},

	// Section 4.1 Rule #2
	{name: "te--st.eth", error: true},
	// Section 4.1 Rule #3
	{name: "test-.eth", error: true},
	{name: "-test.eth", error: true},
	// Section 4.1 Rule #5
	{name: "\u0300test.eth", error: true},

	// Section 2.3: label-separators
	// these are now disallowed by ENS rule
	{name: "test\uFF0Eeth", norm: "test.eth", error: true},
	{name: "test\u3002eth", norm: "test.eth", error: true},
	{name: "test\uFF61eth", norm: "test.eth", error: true},

	// FE0F is stripped due to legacy normalization
	{name: "\u{1f3f3}\u{fe0f}\u{200d}\u{1f308}.eth", norm: "\u{1f3f3}\u{200d}\u{1f308}.eth"},
	{name: "\u{1f3f3}\u{200d}\u{1f308}.eth"},

	// ContextJ
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
	// ZWJ No Context
	{name: "a\u{200C}.eth", error: true},
	// ZWJ Rule#1
	{name: "a\u{94D}\u{200C}.eth"},
	// ZWJ Rule#2
	// TODO: find a valid string
	//{name: "\u{A872}\u{200C}\u{1e939}.eth"},
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
	// ZWNJ No Context
	{name: "a\u{200D}.eth", error: true},
	// ZWNJ Rule#1
	{name: "a\u{094D}\u{200D}.eth"},

	// ZWNJ Emoji
	{name: "👨‍👩‍👦.eth"},
	// Upgraded
	//{name: "👨👩👦.eth", norm: "👨‍👩‍👦.eth"},
	//{name: "🧟♂.eth", norm: "🧟‍♂.eth"},
	{name: "👨👩👦.eth"},
	{name: "🧟♂.eth"},
];

// test known names match expected outcome
export function test_known(ens_normalize) {
	let errors = [];
	for (let {name, norm, error} of KNOWN) {
		let input = escape_unicode(name);
		if (!error && !norm) norm = name; // expect no change
		try {
			let result = ens_normalize(name);
			if (error) {
				error.push({type: 'expected-error', input, name, norm, result, error});
			} else if (result !== norm) {
				error.push({type: 'expected-norm', input, name, norm, result});
			}
		} catch (err) {
			if (!error) {
				errors.push({type: 'unexpected-error', input, name, norm, error: err.message});
			}
		}
	}
	return errors;
}