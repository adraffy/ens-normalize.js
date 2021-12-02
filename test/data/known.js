export default [
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

	// FE0F
	{name: "🏳️‍🌈.eth", norm: "🏳‍🌈.eth"},
	{name: "🏳‍🌈.eth"},
	{name: "🏳️‍🌈.eth", error: true},

	// ContextJ
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
	// ZWJ No Context
	{name: "a\u200C.eth", norm: "a.eth"},
	// ZWJ Rule#1
	{name: "a\u094D\u200C.eth"},
	// ZWJ Rule#2
	{name: "a\uA872\u200C\u0622.eth"},
	// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
	// ZWNJ No Context
	{name: "a\u200D.eth", norm: "a.eth"},
	// ZWNJ Rule#1
	{name: "a\u094D\u200D.eth"},

	// ZWNJ Emoji
	{name: "👨‍👩‍👦.eth"},
	// Upgraded
	//{name: "👨👩👦.eth", norm: "👨‍👩‍👦.eth"},
	//{name: "🧟♂.eth", norm: "🧟‍♂.eth"},
	{name: "👨👩👦.eth"},
	{name: "🧟♂.eth"},
];