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
	{name: "test\uFF0Eeth", norm: "test.eth"},
	{name: "test\u3002eth", norm: "test.eth"},
	{name: "test\uFF61eth", norm: "test.eth"},

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

function explode(s) {
	return typeof s !== 'string' ? 'null' : `"${escape_unicode(s)}"`;
}

// test known names match expected outcome
export function test_known(ens_normalize) {
	KNOWN.forEach(({name, norm, error}, i) => {
		let result;
		if (!error && !norm) norm = name; // no change
		try {
			try {
				result = ens_normalize(name);
			} catch (err) {
				if (!error) {
					console.log(err);
					throw new Error('unexpected error');
				}
				return; // we got expected result
			}
			if (error) {
				throw new Error('expected error');
			} else if (result !== norm) {
				throw new Error(`expected norm`);
			} else {
				return; // we got expected result
			}
		} catch (err) {
			console.error(`Name: ${explode(name)}`);
			console.error(`Norm: ${explode(norm)}`);
			console.error(` Got: ${explode(result)}`);
			throw err;
		}
	});
}