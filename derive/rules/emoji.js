// these emoji are parsed as text
export const EMOJI_DEMOTED = [

	// mapped by idna
	// Computed: 2022-11-06T04:12:30.483Z
	// Version: Unicode(15.0.0) CLDR(42)
	0x2122, // ™ trade mark
	0x2139, // ℹ information
	0x24C2, // Ⓜ circled M
	0x3297, // ㊗ Japanese “congratulations” button
	0x3299, // ㊙ Japanese “secret” button
	0x1F201, // 🈁 Japanese “here” button
	0x1F202, // 🈂 Japanese “service charge” button
	0x1F21A, // 🈚 Japanese “free of charge” button
	0x1F22F, // 🈯 Japanese “reserved” button
	0x1F232, // 🈲 Japanese “prohibited” button
	0x1F233, // 🈳 Japanese “vacancy” button
	0x1F234, // 🈴 Japanese “passing grade” button
	0x1F235, // 🈵 Japanese “no vacancy” button
	0x1F236, // 🈶 Japanese “not free of charge” button
	0x1F237, // 🈷 Japanese “monthly amount” button
	0x1F238, // 🈸 Japanese “application” button
	0x1F239, // 🈹 Japanese “discount” button
	0x1F23A, // 🈺 Japanese “open for business” button
	0x1F250, // 🉐 Japanese “bargain” button
	0x1F251, // 🉑 Japanese “acceptable” button

	// unicode calls these emoji... 
	0x30, // (0) DIGIT ZERO
	0x31, // (1) DIGIT ONE
	0x32, // (2) DIGIT TWO
	0x33, // (3) DIGIT THREE
	0x34, // (4) DIGIT FOUR
	0x35, // (5) DIGIT FIVE
	0x36, // (6) DIGIT SIX
	0x37, // (7) DIGIT SEVEN
	0x38, // (8) DIGIT EIGHT
	0x39, // (9) DIGIT NINE
	0x23, // (#) NUMBER SIGN
	0x2A, // (*) ASTERISK

];

export const EMOJI_DISABLED = [

	// disallowed by idna
	// default-text presentation emoji that look like punctuation
	// https://discuss.ens.domains/t/ens-name-normalization/8652/10
	// https://discuss.ens.domains/t/ens-name-normalization/8652/408
	// https://discuss.ens.domains/t/ens-name-normalization/8652/417
	// can be recreated using the following:
	//   2753 (❓) BLACK QUESTION MARK ORNAMENT
	//   2757 (❗) HEAVY EXCLAMATION MARK SYMBOL
	0x203C, // (‼️) double exclamation mark   // ❗+❗
	0x2049, // (⁉️) exclamation question mark // ❗+❓
	// 20220923: changed to mapping
	// 20221005: changed back to disallow
	
	// note: the following used to be auto-derived
	// but now must be computed manually 
	// because the Emoji_Component data sucks
	// see: dump-emoji-disallowed.js

	// solo skin colors are unsafe 
	// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/10
	// note: "Emoji_Modifier" are not Emoji
	// however they are included in "Emoji_Presentation"	
	0x1F3FB, // (🏻) EMOJI MODIFIER FITZPATRICK TYPE-1-2
	0x1F3FC, // (🏼) EMOJI MODIFIER FITZPATRICK TYPE-3
	0x1F3FD, // (🏽) EMOJI MODIFIER FITZPATRICK TYPE-4
	0x1F3FE, // (🏾) EMOJI MODIFIER FITZPATRICK TYPE-5
	0x1F3FF, // (🏿) EMOJI MODIFIER FITZPATRICK TYPE-6

	// solo RI are non-rgi
	// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
	// "A singleton Regional Indicator character is not a well-formed emoji flag sequence."
	// cannot be typed with an emoji keyboard
	0x1F1E6, // (🇦) REGIONAL INDICATOR SYMBOL LETTER A
	0x1F1E7, // (🇧) REGIONAL INDICATOR SYMBOL LETTER B
	0x1F1E8, // (🇨) REGIONAL INDICATOR SYMBOL LETTER C
	0x1F1E9, // (🇩) REGIONAL INDICATOR SYMBOL LETTER D
	0x1F1EA, // (🇪) REGIONAL INDICATOR SYMBOL LETTER E
	0x1F1EB, // (🇫) REGIONAL INDICATOR SYMBOL LETTER F
	0x1F1EC, // (🇬) REGIONAL INDICATOR SYMBOL LETTER G
	0x1F1ED, // (🇭) REGIONAL INDICATOR SYMBOL LETTER H
	0x1F1EE, // (🇮) REGIONAL INDICATOR SYMBOL LETTER I
	0x1F1EF, // (🇯) REGIONAL INDICATOR SYMBOL LETTER J
	0x1F1F0, // (🇰) REGIONAL INDICATOR SYMBOL LETTER K
	0x1F1F1, // (🇱) REGIONAL INDICATOR SYMBOL LETTER L
	0x1F1F2, // (🇲) REGIONAL INDICATOR SYMBOL LETTER M
	0x1F1F3, // (🇳) REGIONAL INDICATOR SYMBOL LETTER N
	0x1F1F4, // (🇴) REGIONAL INDICATOR SYMBOL LETTER O
	0x1F1F5, // (🇵) REGIONAL INDICATOR SYMBOL LETTER P
	0x1F1F6, // (🇶) REGIONAL INDICATOR SYMBOL LETTER Q
	0x1F1F7, // (🇷) REGIONAL INDICATOR SYMBOL LETTER R
	0x1F1F8, // (🇸) REGIONAL INDICATOR SYMBOL LETTER S
	0x1F1F9, // (🇹) REGIONAL INDICATOR SYMBOL LETTER T
	0x1F1FA, // (🇺) REGIONAL INDICATOR SYMBOL LETTER U
	0x1F1FB, // (🇻) REGIONAL INDICATOR SYMBOL LETTER V
	0x1F1FC, // (🇼) REGIONAL INDICATOR SYMBOL LETTER W
	0x1F1FD, // (🇽) REGIONAL INDICATOR SYMBOL LETTER X
	0x1F1FE, // (🇾) REGIONAL INDICATOR SYMBOL LETTER Y
	0x1F1FF, // (🇿) REGIONAL INDICATOR SYMBOL LETTER Z
	
];


// expects a string of hex codepoints
// examle: 'ABC FE0F'
export const EMOJI_SEQ_BLACKLIST = [

];
	
// expects an emoji object
// example: {hex: '1F93C 1F3FB 200D 2642 FE0F', name: 'man wrestler: light skin tone'}
export const EMOJI_SEQ_WHITELIST = [

	// non-RGI emoji should NOT be whitelisted
	// this should only be for PRE-RELEASE emoji sequences	
	// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/16

	/*
	// https://discuss.ens.domains/t/ens-name-normalization/8652/24
	// MEN WRESTLING
	// https://emojipedia.org/men-wrestling/
	{hex: '1F93C 1F3FB 200D 2642 FE0F', name: 'man wrestler: light skin tone'}, // 🤼🏻‍♂
	{hex: '1F93C 1F3FC 200D 2642 FE0F', name: 'man wrestler: medium-light skin tone'}, // 🤼🏼‍♂
	{hex: '1F93C 1F3FD 200D 2642 FE0F', name: 'man wrestler: medium skin tone'}, // 🤼🏽‍♂
	{hex: '1F93C 1F3FE 200D 2642 FE0F', name: 'man wrestler: medium-dark skin tone'}, // 🤼🏾‍♂
	{hex: '1F93C 1F3FF 200D 2642 FE0F', name: 'man wrestler: dark skin tone'}, // 🤼🏿‍♂
	// WOMEN WRESTLING 
	// https://emojipedia.org/women-wrestling/
	{hex: '1F93C 1F3FB 200D 2640 FE0F', name: 'woman wrestler: light skin tone'}, // 🤼🏻‍♀
	{hex: '1F93C 1F3FC 200D 2640 FE0F', name: 'woman wrestler: medium-light skin tone'}, // 🤼🏼‍♀
	{hex: '1F93C 1F3FD 200D 2640 FE0F', name: 'woman wrestler: medium skin tone'}, // 🤼🏽‍♀
	{hex: '1F93C 1F3FE 200D 2640 FE0F', name: 'woman wrestler: medium-dark skin tone'}, // 🤼🏾‍♀
	{hex: '1F93C 1F3FF 200D 2640 FE0F', name: 'woman wrestler: dark skin tone'}, // 🤼🏿‍♀

	// missing MOD_BASE + MODIFIER combinations
	// https://discuss.ens.domains/t/ens-name-normalization/8652/408
	// FAMILY  
	// https://emojipedia.org/family/
	{hex: '1F46A 1F3FB', name: 'family: light skin tone'}, // 👪🏻
	{hex: '1F46A 1F3FC', name: 'family: medium-light skin tone'}, // 👪🏼
	{hex: '1F46A 1F3FD', name: 'family: medium skin tone'}, // 👪🏽
	{hex: '1F46A 1F3FE', name: 'family: medium-dark skin tone'}, // 👪🏾
	{hex: '1F46A 1F3FF', name: 'family: dark skin tone'}, // 👪🏿
	// PEOPLE WITH BUNNY EARS 
	// https://emojipedia.org/people-with-bunny-ears/
	{hex: '1F46F 1F3FB', name: 'people with bunny ears: light skin tone'}, // 👯🏻
	{hex: '1F46F 1F3FC', name: 'people with bunny ears: medium-light skin tone'}, // 👯🏼
	{hex: '1F46F 1F3FD', name: 'people with bunny ears: medium skin tone'}, // 👯🏽
	{hex: '1F46F 1F3FE', name: 'people with bunny ears: medium-dark skin tone'}, // 👯🏾
	{hex: '1F46F 1F3FF', name: 'people with bunny ears: dark skin tone'}, // 👯🏿
	// PEOPLE WRESTLING
	// https://emojipedia.org/people-wrestling/
	{hex: '1F93C 1F3FB', name: 'people wrestling: light skin tone'}, // 🤼🏻
	{hex: '1F93C 1F3FC', name: 'people wrestling: medium-light skin tone'}, // 🤼🏼
	{hex: '1F93C 1F3FD', name: 'people wrestling: medium skin tone'}, // 🤼🏽
	{hex: '1F93C 1F3FE', name: 'people wrestling: medium-dark skin tone'}, // 🤼🏾
	{hex: '1F93C 1F3FF', name: 'people wrestling: dark skin tone'}, // 🤼🏿
	*/

];