# ENSIP-?: Standardization of ENS Name Normalization 

| **Author**  | Andrew Raffensperger \<raffy@me.com> |
| ----------- | ------------------------------------ |
| **Status**  | Draft                                |
| **Created** | 2022-04-20                           |

## Abstract

This ENSIP standardizes, versions, and resolves implementation details of the Ethereum Name Service (ENS) name normalization process outlined in [ENSIP-1 § Name Syntax](https://docs.ens.domains/ens-improvement-proposals/ensip-1-ens#name-syntax).  Since ENSIP-1 was finalized in 2016, Unicode has [evolved](https://unicode.org/history/publicationdates.html) from version 8.0.0 to 14.0.0 and incorporated many new characters, including complex emoji sequences.

The goal of this ENSIP to standardize the exact normalization algorithm, pin an explicit Unicode version, and elucidate many implementation details and edge cases.  This ENSIP introduces an explicit set of modifications to the existing standard to reduce visually-confusing names and improve compatibility with future Unicode updates.  Additionally, a validation set of names is provided for implementation testing.

As of this ENSIP, over 780K names have been registered on mainnet.  Great effort has been made to preserve as many names as possible while also improving future Unicode compatibility.  Unfortunately, some registered names will become unreachable if the normalization outlined in this ENSIP is applied.

## Motivation

* Since ENSIP-1, Unicode has evolved from version 8.0.0 to 14.0.0 (6 major bumps) and ENSIP does not state an explicit version number. 
* ENSIP-1 implies but does not state an explicit flavor of IDNA processing. 
* [UTS-46](https://unicode.org/reports/tr46/) is insufficient to correctly normalize emoji sequences. Correct emoji parsing is only possible with [UTS-51](https://www.unicode.org/reports/tr51/).
* There does not exist a validation set of unormalized and normalized names.
* The success of ENS has encouraged spoofing&mdash;registering a visually similar name with exotic characters&mdash;via the following techniques:
	* Insertion of zero-width characters
	* Replacement of look-alike (confusable) characters
	* Using names which normalize differently between available algorithms 

## Specification

* Normalization is the process of converting an ENS name into a canonical form.  It either produces a result or throws an error.
* It is idempotent:  applying normalization mutliple times produces the same result.
* All whitespace characters (without context) are disallowed.  For user convenience, leading and trailing whitespace can be trimmed before application.
* Input is processed left-to-right, first looking for emoji sequences according to [UTS-51](https://unicode.org/reports/tr51/), and then text sequences according to [UTS-46](https://unicode.org/reports/tr46/).
* Unicode version = `14.0.0`
* UTS-51 parsing has the following modifications:
	* [Whitelisted sequences](#whitelisted-emoji-sequences) are matched first
	* [A small set of emoji](#demoted-emoji-characters) are demoted and not processed
	* [Tag Sequences](https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence) are not processed	
		* Tag Sequences can embed hidden data
	* [Flag Sequences](https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence) are not processed 
	* [Keycap Sequences](https://www.unicode.org/reports/tr51/#def_emoji_keycap_sequence) have a special case to account for legacy normalization:
		* `[#*] FE0F 20E3` is parsed verbatim
		* `[0-9] FE0F? 20E3` (where `FE0F` is optional) is parsed as `[0-9] 20E3`
	* [Presentation Sequences](https://www.unicode.org/reports/tr51/#def_emoji_presentation_sequence) have a special case to account for legacy normalization:
		* `X FE0F` is parsed verbatim, where `X` is a [new emoji](#emoji-that-require-fe0f).
		* `X FE0F?` (where `FE0F` is optional) is parsed as `X`, where `X` is a [legacy emoji](#emoji-that-drop-fe0f).
	* [ZWJ Sequences](https://www.unicode.org/reports/tr51/#def_emoji_zwj_sequence) are either:
		* [RGI Sequences](https://unicode.org/Public/emoji/14.0/emoji-zwj-sequences.txt)
		* [Whitelisted Non-RGI Sequences](#whitelisted-non-rgi-emoji-sequences)
* UTS-46 parsing has the following modifications:
	* *UseSTD3ASCIIRules* = `true`
	* *Transitional* = `false`
		* IDNA 2008 
		* [Deviations](https://unicode.org/reports/tr46/#IDNA2008-Section) are Valid
		* [NV8 and XV8](https://unicode.org/reports/tr46/#Table_Data_File_Fields) are Disallowed
	* *CheckHyphens* = `false`
	* *CheckBidi* = `true`
		* Must operate on the "textual form" of each label, where emoji before the first non-emoji character are ignored, emoji afterwards are replaced with `FE0F`.  
		* This permits unrestricted emoji placement in right-to-left labels.
	* *CheckJoiners* = `true` &rarr; ContextJ:
		* [Zero Width Non-Joiner](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1)
		* [Zero Width Joiner](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2)
	* Punycode is [not processed](https://unicode.org/reports/tr46/#ProcessingStepConvertValidate)
	* ContextO:
		* [Middle Dot](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3)
		* [Greek Keraia](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.4)
		* [Hebrew Geresh](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.5)
		* [Hebrew Gershayim](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.6)
		* [Katakana Middle Dot](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.7)
		* [Arabic-Indic Digits](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.8)
		* [Extended Arabic-Indic Digits](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.9)
	* The following [characters are valid](#idna-valid-characters)
	* The following [characters are disallowed](#idna-disallowed-characters)
* The only valid stop character is `002E (.) FULL STOP`
	* This permits efficient label identification in unstructured text without normalization processing.
* [NFC (Unicode Normalization Form C)](https://unicode.org/reports/tr15/) should use the same Unicode version.
	* Language-level NFC functions, like [`String.normalize()`](https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.normalize), may produce inconsistent results on different platforms.

### (Approximate) Legacy Specification 

The most common implementation (prior to this ENSIP) was only UTS-46 processing with the following modifications:

* *UseSTD3ASCIIRules* = `true`
* *Transitional* = `false`
	* IDNA 2003
	* Deviations are Valid
* *CheckHyphens* = `false`
* *CheckBidi* = `false`
* *CheckJoiners* = `false` &rarr; No ContextJ
* No ContextO
* Unversioned NFC
* No [Combining Mark](https://unicode.org/reports/tr46/#Validity_Criteria) Check

## Legacy Implementation Specifics

* Certain emoji exist in [multiple styles](https://www.unicode.org/reports/tr51/#Emoji_Variation_Sequences): 
	* Unstyled (`XXX`, eg. `💩`)
	* Text-styled (`XXX FE0E`, eg. `💩︎`)
	* Emoji-styled  (`XXX FE0F`, eg. `💩️`)
* Because `FE0E` and `FE0F` were ignored, styling cannot be distinguished.
* [Legacy emoji](#emoji-that-drop-fe0f) are accepted as Emoji-styled or Unstyled for backwards compatibility.
	* Text-styled emoji should be interpeted as Unstyled followed by `FE0E`.
* [New emoji](#emoji-that-require-fe0f) are only accepted as Emoji-styled.  
	* This makes future use of emoji explicit.
* [ZWJ Sequences](https://www.unicode.org/reports/tr51/#def_emoji_zwj_element) terminate when a Text-styled emoji is encountered.
	* `emoji_zwj_element` is not a `text_presentation_sequence`
* Some emoji were mapped by IDNA to non-emoji characters and must be [demoted](#demoted-emoji-characters) for backwards compatibility.
* Characters `[0-9#*]` are [demoted](#demoted-emoji-characters) because they are visually-indistinguishable from their emoji counterpart with text-styling.  For example:
	* `(1)` Digit One: `0031`
	* `(1︎)` Text-styled Emoji Digit One: `0031 FE0E`
	* `(1️)` Emoji-styled Emoji Digit One: `0031 FE0F`
	* `(1️⃣)` Keycap Digit One: `0031 FE0F 20E3`
* Since the emoji forms of `[0-9#*]` are disabled, their corresponding keycap forms are allowed.

## Effects on Registered Names

* Moving from IDNA 2003 to IDNA 2008 will make some names invalid.
* All names that include ZWJ/ZWNJ outside of ContextJ or ZWJ Sequences are invalid.
* Names with bidirectional characters have additional constraints.

The following names will be an error under this ENSIP: 

* Any name that contains an ZWJ/ZWNJ outside of valid ZWJ Sequences or ContextJ 

## Appendix: Reference Specifications

* [ENSIP-1: ENS](https://docs.ens.domains/ens-improvement-proposals/ensip-1-ens)
* [UTS-46: IDNA Compatibility Processing](https://unicode.org/reports/tr46/)
* [UTS-51: Emoji](https://www.unicode.org/reports/tr51)
* [RFC-5891: IDNA: Protocol](https://datatracker.ietf.org/doc/html/rfc5891) 
* [RFC-5892: The Unicode Code Points and IDNA](https://datatracker.ietf.org/doc/html/rfc5892)
* [RFC-5893: Right-to-Left Scripts for IDNA](https://datatracker.ietf.org/doc/html/rfc5893)
* [UAX-15: Normalization Forms](https://unicode.org/reports/tr15/)
* ~~[RFC-3492: Punycode](https://datatracker.ietf.org/doc/html/rfc3492)~~

## Appendix: Unicode Data Sources

* [IdnaMappingTable.txt](https://unicode.org/Public/idna/14.0.0/IdnaMappingTable.txt)
* [UnicodeData.txt](https://unicode.org/Public/14.0.0/ucd/UnicodeData.txt)
* [DerivedGeneralCategory.txt](https://unicode.org/Public/14.0.0/ucd/extracted/DerivedGeneralCategory.txt)
* [DerivedCombiningClass.txt](https://unicode.org/Public/14.0.0/ucd/extracted/DerivedCombiningClass.txt)
* [DerivedJoiningType.txt](https://unicode.org/Public/14.0.0/ucd/extracted/DerivedJoiningType.txt)
* [DerivedBidiClass.txt](https://unicode.org/Public/14.0.0/ucd/extracted/DerivedBidiClass.txt)
* [DerivedDecompositionType.txt](https://unicode.org/Public/14.0.0/ucd/extracted/DerivedDecompositionType.txt)
* [Scripts.txt](https://unicode.org/Public/14.0.0/ucd/Scripts.txt)
* [DerivedNormalizationProps.txt](https://unicode.org/Public/14.0.0/ucd/DerivedNormalizationProps.txt)
* [CompositionExclusions.txt](https://unicode.org/Public/14.0.0/ucd/CompositionExclusions.txt)
* [emoji-sequences.txt](https://unicode.org/Public/emoji/14.0/emoji-sequences.txt)
* [emoji-zwj-sequences.txt](https://unicode.org/Public/emoji/14.0/emoji-zwj-sequences.txt)
* [emoji-variation-sequences.txt](https://unicode.org/Public/14.0.0/ucd/emoji/emoji-variation-sequences.txt)
* [emoji-data.txt](https://unicode.org/Public/14.0.0/ucd/emoji/emoji-data.txt)

## Appendix: Test Cases

### Expect Pass: Unchanged
```Javascript
[
	'', // empty
	'.', // null labels
	'.eth', // null labels
	'..eth', // null labels
	'vitalik.eth',
	'brantly.cash', // non-eth tld
	'öbb.at',
	'nowzad.loopring.eth', // subdomain
	'ß.eth', // deviation
	'ς.eth', // deviation
	't_e_s_t.eth', // valid underscore
	'$£¥€₿.eth', // valid currency symbols
	'🇦', // single regional indicator
	'🇦🇦', // double regional indicator: invalid flag sequence
	'🇺🇸', // double regional indicator: flag sequence

	// CheckHyphens is false
	'te--st.eth', // Section 4.1 Rule #2	
	'test-.eth',  // Section 4.1 Rule #3A
	'-test.eth',  // Section 4.1 Rule #3B

	// Punycode is ignored
	'xn--ls8h.eth',  // valid
	'xn--💩', // invalid

	'🚀🚀🚀.eth', 
	'💩💩💩.eth',
	'🌈rainbow.eth', // emoji + text
	'🧟‍♂.eth', // zombie
	'🧟♂.eth',  // zombie w/gender
	'😵💫😵💫😵💫.eth', // no zwj
	'😵\u{200D}💫😵\u{200D}💫😵\u{200D}💫.eth', // zwj seq,
	'🏴.eth', // solo flag
	'🏴󠁧󠁢󠁥󠁮󠁧󠁿.eth', // whitelisted seq
	'🏴󠁧󠁢󠁳󠁣󠁴󠁿.eth', 
	'🏴󠁧󠁢󠁷󠁬󠁳󠁿.eth',

	// ContextJ
	'a्‌.eth', // ZWNJ Rule 1
	'ࡃ࣭‌߲ܓ.eth', // ZWNJ Rule 2
	'a्‍.eth', // ZWJ

	// ContextO
	'l·l.eth', // Middle Dot
	'ab͵ͷ.eth', // Greek Keraia
	'ב֑׳.eth', // Hebrew Geresh
	'ぁァ・.eth', // Katakana
	'א٠١٢.eth', // [Arabic]-Indic
	'א۰۱۲.eth', // Arabic-[Indic]

	// CheckBidi
	'פעילותהבינאום.eth', 
	'ކޮންޕީޓަރު.eth', // Dhivehi
	'יִואָ.eth', //  Yiddish,
	'bahrain.مصر', // separate LTR and RTL
	'🇸🇦سلمان.eth', // emoji + RTL 

	// new emoji
	'‼️.eth',
	'⁉️.eth',
	'#️⃣*️⃣.eth', // modern keycap
]
```
### Expect Pass: Transformed
```Javascript
[
	{name: 'bRAnTlY.eTh', norm: 'brantly.eth'}, // casefolding
	{name: 'Öbb.at', norm: 'öbb.at'}, 
	{name: 'Ⅷ', norm: 'viii'}, // mapping
	{name: 'ⓂⓂⓂ.eth', norm: 'mmm.eth'},
	{name: 'Ⓜ️Ⓜ️Ⓜ️.eth', norm: 'mmm.eth'},
	{name: '︎\u{FE0E}\u{FE0E}.eth', norm: '.eth'}, // ignored emoji-styling
	{name: '🚴‍♂️.eth', norm: '🚴‍♂.eth'}, // drop FE0F
	{name: '🏳️‍🌈.eth', norm: '🏳‍🌈.eth'},
	{name: '👩🏽‍⚕️.eth', norm: '👩🏽‍⚕.eth'},
	{name: '👁️‍🗨️.eth', norm: '👁‍🗨.eth'}, // drop 2x FE0F
	{name: '6️⃣9️⃣.eth', norm: '6⃣9⃣.eth'}, // legacy keycaps
]
```
### Expect Fail
```Javascript
[
	'◌̈bb.at',
	'💩\u{200D}💩.eth', // Invalid ZWJ Sequence
	'🏴󠁷󠁴󠁦󠁿\u{E0077}\u{E0074}\u{E0066}\u{E007F}.eth', // Invalid Tag Sequence

	'🅜🅜🅜.eth', 
	'🅼🅼🅼.eth', 
	'❻❻❻.eth',
	'➏➏➏.eth',

	'te[st.eth',
	' test.eth', // Whitespace: leading
	'test.eth ', // Whitespace: trailing
	'te st.eth', // Whitespace: internal

	'test\u{FF0E}eth', // Disallowed Alternative Stops
	'test\u{3002}eth', // Disallowed Alternative Stops
	'test\u{FF61}eth', // Disallowed Alternative Stops

	// ContextJ
	'a\u{200C}b.eth', // ZWNJ Rule 2
	'🧞\u{200D}.eth', // ZWNJ
	'a\u{200D}b.eth', // ZWJ
	'🧞\u{200C}.eth', // ZWJ

	// ContextO
	'a·b.eth', // Middle Dot
	'ab͵.eth', // Greek Keraia
	'ab׳.eth', // Hebrew Geresh
	'ab・.eth', // Katakana
	'٠۰.eth', // Arabic-Indic

	// CheckBidi
	'\u{202E}elgoog\u{202D}.eth', // direction modifier
	'\u{202E}hte.elgoog', // direction modifier
	'bahrainمصر.eth', // mixed LTR+RTL
]
```

## Appendix: Datasets 

### Valid Text Characters

```Javascript
[
	'005F', // (_) Underscore
	'0024',	// ($) Dollar Sign
	'00A3', // (£) Pound Sign
	'00A5', // (¥) Yen Sign
	'20AC', // (€) Euro Sign
	'20BF', // (₿) Bitcoin Sign
]
```

### Disallowed Text Characters

```Javascript
[
	'3002', // (。) Ideographic Full Stop
	'FF0E', // (．) Fullwidth Full Stop
	'FF61', // (｡) Halfwidth Ideographic Full Stop
	'0332', // (◌̲) Combining Low Line`
]
```

### Whitelisted Emoji Sequences

```Javascript
[
	'1F3F4 E0067 E0062 E0065 E006E E0067 E007F', // 🏴󠁧󠁢󠁥󠁮󠁧󠁿
	'1F3F4 E0067 E0062 E0073 E0063 E0074 E007F', // 🏴󠁧󠁢󠁳󠁣󠁴󠁿
	'1F3F4 E0067 E0062 E0077 E006C E0073 E007F', // 🏴󠁧󠁢󠁷󠁬󠁳󠁿
]
```

### Whitelisted Non-RGI Emoji Sequences

```Javascript
[
	// men wrestling
	'1F93C 1F3FB 200D 2642',
	'1F93C 1F3FC 200D 2642',
	'1F93C 1F3FD 200D 2642',
	'1F93C 1F3FE 200D 2642',
	'1F93C 1F3FF 200D 2642',

	// women wrestling
	'1F93C 1F3FB 200D 2640',
	'1F93C 1F3FC 200D 2640',
	'1F93C 1F3FD 200D 2640',
	'1F93C 1F3FE 200D 2640',
	'1F93C 1F3FF 200D 2640',
]
```

### Demoted Emoji Characters

```Javascript
[
	// mapped by IDNA 2003
	'2122', // ™ -> tm
	'2139', // ℹ -> i
	'24C2', // Ⓜ -> m
	'3297', // ㊗ -> 祝
	'3299', // ㊙ -> 秘
	'1F201', // 🈁 -> ココ
	'1F202', // 🈂 -> サ
	'1F21A', // 🈚 -> 無
	'1F22F', // 🈯 -> 指
	'1F232', // 🈲 -> 禁
	'1F233', // 🈳 -> 空
	'1F234', // 🈴 -> 合
	'1F235', // 🈵 -> 満
	'1F236', // 🈶 -> 有
	'1F237', // 🈷 -> 月
	'1F238', // 🈸 -> 申
	'1F239', // 🈹 -> 割
	'1F23A', // 🈺 -> 営
	'1F250', // 🉐 -> 得
	'1F251', // 🉑 -> 可
	
	// solo character ambiguious with text-styled emoji
	'23', // #
	'2A', // *
	'30', // 0
	'31', // 1
	'32', // 2
	'33', // 3
	'34', // 4
	'35', // 5
	'36', // 6
	'37', // 7
	'38', // 8
	'39', // 9
]
```

### Emoji That Require `FE0F`

```Javascript
[
	'203C', // ‼️
	'2049', // ⁉️
]
```

### Emoji That Drop `FE0F`

```Javascript
[
	'A9', // ©
	'AE', // ®
	'2194', // ↔
	'2195', // ↕
	'2196', // ↖
	'2197', // ↗
	'2198', // ↘
	'2199', // ↙
	'21A9', // ↩
	'21AA', // ↪
	'231A', // ⌚
	'231B', // ⌛
	'2328', // ⌨
	'23CF', // ⏏
	'23E9', // ⏩
	'23EA', // ⏪
	'23EB', // ⏫
	'23EC', // ⏬
	'23ED', // ⏭
	'23EE', // ⏮
	'23EF', // ⏯
	'23F0', // ⏰
	'23F1', // ⏱
	'23F2', // ⏲
	'23F3', // ⏳
	'23F8', // ⏸
	'23F9', // ⏹
	'23FA', // ⏺
	'25AA', // ▪
	'25AB', // ▫
	'25B6', // ▶
	'25C0', // ◀
	'25FB', // ◻
	'25FC', // ◼
	'25FD', // ◽
	'25FE', // ◾
	'2600', // ☀
	'2601', // ☁
	'2602', // ☂
	'2603', // ☃
	'2604', // ☄
	'260E', // ☎
	'2611', // ☑
	'2614', // ☔
	'2615', // ☕
	'2618', // ☘
	'261D', // ☝
	'2620', // ☠
	'2622', // ☢
	'2623', // ☣
	'2626', // ☦
	'262A', // ☪
	'262E', // ☮
	'262F', // ☯
	'2638', // ☸
	'2639', // ☹
	'263A', // ☺
	'2640', // ♀
	'2642', // ♂
	'2648', // ♈
	'2649', // ♉
	'264A', // ♊
	'264B', // ♋
	'264C', // ♌
	'264D', // ♍
	'264E', // ♎
	'264F', // ♏
	'2650', // ♐
	'2651', // ♑
	'2652', // ♒
	'2653', // ♓
	'265F', // ♟
	'2660', // ♠
	'2663', // ♣
	'2665', // ♥
	'2666', // ♦
	'2668', // ♨
	'267B', // ♻
	'267E', // ♾
	'267F', // ♿
	'2692', // ⚒
	'2693', // ⚓
	'2694', // ⚔
	'2695', // ⚕
	'2696', // ⚖
	'2697', // ⚗
	'2699', // ⚙
	'269B', // ⚛
	'269C', // ⚜
	'26A0', // ⚠
	'26A1', // ⚡
	'26A7', // ⚧
	'26AA', // ⚪
	'26AB', // ⚫
	'26B0', // ⚰
	'26B1', // ⚱
	'26BD', // ⚽
	'26BE', // ⚾
	'26C4', // ⛄
	'26C5', // ⛅
	'26C8', // ⛈
	'26CE', // ⛎
	'26CF', // ⛏
	'26D1', // ⛑
	'26D3', // ⛓
	'26D4', // ⛔
	'26E9', // ⛩
	'26EA', // ⛪
	'26F0', // ⛰
	'26F1', // ⛱
	'26F2', // ⛲
	'26F3', // ⛳
	'26F4', // ⛴
	'26F5', // ⛵
	'26F7', // ⛷
	'26F8', // ⛸
	'26F9', // ⛹
	'26FA', // ⛺
	'26FD', // ⛽
	'2702', // ✂
	'2705', // ✅
	'2708', // ✈
	'2709', // ✉
	'270A', // ✊
	'270B', // ✋
	'270C', // ✌
	'270D', // ✍
	'270F', // ✏
	'2712', // ✒
	'2714', // ✔
	'2716', // ✖
	'271D', // ✝
	'2721', // ✡
	'2728', // ✨
	'2733', // ✳
	'2734', // ✴
	'2744', // ❄
	'2747', // ❇
	'274C', // ❌
	'274E', // ❎
	'2753', // ❓
	'2754', // ❔
	'2755', // ❕
	'2757', // ❗
	'2763', // ❣
	'2764', // ❤
	'2795', // ➕
	'2796', // ➖
	'2797', // ➗
	'27A1', // ➡
	'27B0', // ➰
	'27BF', // ➿
	'2934', // ⤴
	'2935', // ⤵
	'2B05', // ⬅
	'2B06', // ⬆
	'2B07', // ⬇
	'2B1B', // ⬛
	'2B1C', // ⬜
	'2B50', // ⭐
	'2B55', // ⭕
	'3030', // 〰
	'303D', // 〽
	'1F004', // 🀄
	'1F0CF', // 🃏
	'1F170', // 🅰
	'1F171', // 🅱
	'1F17E', // 🅾
	'1F17F', // 🅿
	'1F18E', // 🆎
	'1F191', // 🆑
	'1F192', // 🆒
	'1F193', // 🆓
	'1F194', // 🆔
	'1F195', // 🆕
	'1F196', // 🆖
	'1F197', // 🆗
	'1F198', // 🆘
	'1F199', // 🆙
	'1F19A', // 🆚
	'1F1E6', // 🇦
	'1F1E7', // 🇧
	'1F1E8', // 🇨
	'1F1E9', // 🇩
	'1F1EA', // 🇪
	'1F1EB', // 🇫
	'1F1EC', // 🇬
	'1F1ED', // 🇭
	'1F1EE', // 🇮
	'1F1EF', // 🇯
	'1F1F0', // 🇰
	'1F1F1', // 🇱
	'1F1F2', // 🇲
	'1F1F3', // 🇳
	'1F1F4', // 🇴
	'1F1F5', // 🇵
	'1F1F6', // 🇶
	'1F1F7', // 🇷
	'1F1F8', // 🇸
	'1F1F9', // 🇹
	'1F1FA', // 🇺
	'1F1FB', // 🇻
	'1F1FC', // 🇼
	'1F1FD', // 🇽
	'1F1FE', // 🇾
	'1F1FF', // 🇿
	'1F300', // 🌀
	'1F301', // 🌁
	'1F302', // 🌂
	'1F303', // 🌃
	'1F304', // 🌄
	'1F305', // 🌅
	'1F306', // 🌆
	'1F307', // 🌇
	'1F308', // 🌈
	'1F309', // 🌉
	'1F30A', // 🌊
	'1F30B', // 🌋
	'1F30C', // 🌌
	'1F30D', // 🌍
	'1F30E', // 🌎
	'1F30F', // 🌏
	'1F310', // 🌐
	'1F311', // 🌑
	'1F312', // 🌒
	'1F313', // 🌓
	'1F314', // 🌔
	'1F315', // 🌕
	'1F316', // 🌖
	'1F317', // 🌗
	'1F318', // 🌘
	'1F319', // 🌙
	'1F31A', // 🌚
	'1F31B', // 🌛
	'1F31C', // 🌜
	'1F31D', // 🌝
	'1F31E', // 🌞
	'1F31F', // 🌟
	'1F320', // 🌠
	'1F321', // 🌡
	'1F324', // 🌤
	'1F325', // 🌥
	'1F326', // 🌦
	'1F327', // 🌧
	'1F328', // 🌨
	'1F329', // 🌩
	'1F32A', // 🌪
	'1F32B', // 🌫
	'1F32C', // 🌬
	'1F32D', // 🌭
	'1F32E', // 🌮
	'1F32F', // 🌯
	'1F330', // 🌰
	'1F331', // 🌱
	'1F332', // 🌲
	'1F333', // 🌳
	'1F334', // 🌴
	'1F335', // 🌵
	'1F336', // 🌶
	'1F337', // 🌷
	'1F338', // 🌸
	'1F339', // 🌹
	'1F33A', // 🌺
	'1F33B', // 🌻
	'1F33C', // 🌼
	'1F33D', // 🌽
	'1F33E', // 🌾
	'1F33F', // 🌿
	'1F340', // 🍀
	'1F341', // 🍁
	'1F342', // 🍂
	'1F343', // 🍃
	'1F344', // 🍄
	'1F345', // 🍅
	'1F346', // 🍆
	'1F347', // 🍇
	'1F348', // 🍈
	'1F349', // 🍉
	'1F34A', // 🍊
	'1F34B', // 🍋
	'1F34C', // 🍌
	'1F34D', // 🍍
	'1F34E', // 🍎
	'1F34F', // 🍏
	'1F350', // 🍐
	'1F351', // 🍑
	'1F352', // 🍒
	'1F353', // 🍓
	'1F354', // 🍔
	'1F355', // 🍕
	'1F356', // 🍖
	'1F357', // 🍗
	'1F358', // 🍘
	'1F359', // 🍙
	'1F35A', // 🍚
	'1F35B', // 🍛
	'1F35C', // 🍜
	'1F35D', // 🍝
	'1F35E', // 🍞
	'1F35F', // 🍟
	'1F360', // 🍠
	'1F361', // 🍡
	'1F362', // 🍢
	'1F363', // 🍣
	'1F364', // 🍤
	'1F365', // 🍥
	'1F366', // 🍦
	'1F367', // 🍧
	'1F368', // 🍨
	'1F369', // 🍩
	'1F36A', // 🍪
	'1F36B', // 🍫
	'1F36C', // 🍬
	'1F36D', // 🍭
	'1F36E', // 🍮
	'1F36F', // 🍯
	'1F370', // 🍰
	'1F371', // 🍱
	'1F372', // 🍲
	'1F373', // 🍳
	'1F374', // 🍴
	'1F375', // 🍵
	'1F376', // 🍶
	'1F377', // 🍷
	'1F378', // 🍸
	'1F379', // 🍹
	'1F37A', // 🍺
	'1F37B', // 🍻
	'1F37C', // 🍼
	'1F37D', // 🍽
	'1F37E', // 🍾
	'1F37F', // 🍿
	'1F380', // 🎀
	'1F381', // 🎁
	'1F382', // 🎂
	'1F383', // 🎃
	'1F384', // 🎄
	'1F385', // 🎅
	'1F386', // 🎆
	'1F387', // 🎇
	'1F388', // 🎈
	'1F389', // 🎉
	'1F38A', // 🎊
	'1F38B', // 🎋
	'1F38C', // 🎌
	'1F38D', // 🎍
	'1F38E', // 🎎
	'1F38F', // 🎏
	'1F390', // 🎐
	'1F391', // 🎑
	'1F392', // 🎒
	'1F393', // 🎓
	'1F396', // 🎖
	'1F397', // 🎗
	'1F399', // 🎙
	'1F39A', // 🎚
	'1F39B', // 🎛
	'1F39E', // 🎞
	'1F39F', // 🎟
	'1F3A0', // 🎠
	'1F3A1', // 🎡
	'1F3A2', // 🎢
	'1F3A3', // 🎣
	'1F3A4', // 🎤
	'1F3A5', // 🎥
	'1F3A6', // 🎦
	'1F3A7', // 🎧
	'1F3A8', // 🎨
	'1F3A9', // 🎩
	'1F3AA', // 🎪
	'1F3AB', // 🎫
	'1F3AC', // 🎬
	'1F3AD', // 🎭
	'1F3AE', // 🎮
	'1F3AF', // 🎯
	'1F3B0', // 🎰
	'1F3B1', // 🎱
	'1F3B2', // 🎲
	'1F3B3', // 🎳
	'1F3B4', // 🎴
	'1F3B5', // 🎵
	'1F3B6', // 🎶
	'1F3B7', // 🎷
	'1F3B8', // 🎸
	'1F3B9', // 🎹
	'1F3BA', // 🎺
	'1F3BB', // 🎻
	'1F3BC', // 🎼
	'1F3BD', // 🎽
	'1F3BE', // 🎾
	'1F3BF', // 🎿
	'1F3C0', // 🏀
	'1F3C1', // 🏁
	'1F3C2', // 🏂
	'1F3C3', // 🏃
	'1F3C4', // 🏄
	'1F3C5', // 🏅
	'1F3C6', // 🏆
	'1F3C7', // 🏇
	'1F3C8', // 🏈
	'1F3C9', // 🏉
	'1F3CA', // 🏊
	'1F3CB', // 🏋
	'1F3CC', // 🏌
	'1F3CD', // 🏍
	'1F3CE', // 🏎
	'1F3CF', // 🏏
	'1F3D0', // 🏐
	'1F3D1', // 🏑
	'1F3D2', // 🏒
	'1F3D3', // 🏓
	'1F3D4', // 🏔
	'1F3D5', // 🏕
	'1F3D6', // 🏖
	'1F3D7', // 🏗
	'1F3D8', // 🏘
	'1F3D9', // 🏙
	'1F3DA', // 🏚
	'1F3DB', // 🏛
	'1F3DC', // 🏜
	'1F3DD', // 🏝
	'1F3DE', // 🏞
	'1F3DF', // 🏟
	'1F3E0', // 🏠
	'1F3E1', // 🏡
	'1F3E2', // 🏢
	'1F3E3', // 🏣
	'1F3E4', // 🏤
	'1F3E5', // 🏥
	'1F3E6', // 🏦
	'1F3E7', // 🏧
	'1F3E8', // 🏨
	'1F3E9', // 🏩
	'1F3EA', // 🏪
	'1F3EB', // 🏫
	'1F3EC', // 🏬
	'1F3ED', // 🏭
	'1F3EE', // 🏮
	'1F3EF', // 🏯
	'1F3F0', // 🏰
	'1F3F3', // 🏳
	'1F3F4', // 🏴
	'1F3F5', // 🏵
	'1F3F7', // 🏷
	'1F3F8', // 🏸
	'1F3F9', // 🏹
	'1F3FA', // 🏺
	'1F3FB', // 🏻
	'1F3FC', // 🏼
	'1F3FD', // 🏽
	'1F3FE', // 🏾
	'1F3FF', // 🏿
	'1F400', // 🐀
	'1F401', // 🐁
	'1F402', // 🐂
	'1F403', // 🐃
	'1F404', // 🐄
	'1F405', // 🐅
	'1F406', // 🐆
	'1F407', // 🐇
	'1F408', // 🐈
	'1F409', // 🐉
	'1F40A', // 🐊
	'1F40B', // 🐋
	'1F40C', // 🐌
	'1F40D', // 🐍
	'1F40E', // 🐎
	'1F40F', // 🐏
	'1F410', // 🐐
	'1F411', // 🐑
	'1F412', // 🐒
	'1F413', // 🐓
	'1F414', // 🐔
	'1F415', // 🐕
	'1F416', // 🐖
	'1F417', // 🐗
	'1F418', // 🐘
	'1F419', // 🐙
	'1F41A', // 🐚
	'1F41B', // 🐛
	'1F41C', // 🐜
	'1F41D', // 🐝
	'1F41E', // 🐞
	'1F41F', // 🐟
	'1F420', // 🐠
	'1F421', // 🐡
	'1F422', // 🐢
	'1F423', // 🐣
	'1F424', // 🐤
	'1F425', // 🐥
	'1F426', // 🐦
	'1F427', // 🐧
	'1F428', // 🐨
	'1F429', // 🐩
	'1F42A', // 🐪
	'1F42B', // 🐫
	'1F42C', // 🐬
	'1F42D', // 🐭
	'1F42E', // 🐮
	'1F42F', // 🐯
	'1F430', // 🐰
	'1F431', // 🐱
	'1F432', // 🐲
	'1F433', // 🐳
	'1F434', // 🐴
	'1F435', // 🐵
	'1F436', // 🐶
	'1F437', // 🐷
	'1F438', // 🐸
	'1F439', // 🐹
	'1F43A', // 🐺
	'1F43B', // 🐻
	'1F43C', // 🐼
	'1F43D', // 🐽
	'1F43E', // 🐾
	'1F43F', // 🐿
	'1F440', // 👀
	'1F441', // 👁
	'1F442', // 👂
	'1F443', // 👃
	'1F444', // 👄
	'1F445', // 👅
	'1F446', // 👆
	'1F447', // 👇
	'1F448', // 👈
	'1F449', // 👉
	'1F44A', // 👊
	'1F44B', // 👋
	'1F44C', // 👌
	'1F44D', // 👍
	'1F44E', // 👎
	'1F44F', // 👏
	'1F450', // 👐
	'1F451', // 👑
	'1F452', // 👒
	'1F453', // 👓
	'1F454', // 👔
	'1F455', // 👕
	'1F456', // 👖
	'1F457', // 👗
	'1F458', // 👘
	'1F459', // 👙
	'1F45A', // 👚
	'1F45B', // 👛
	'1F45C', // 👜
	'1F45D', // 👝
	'1F45E', // 👞
	'1F45F', // 👟
	'1F460', // 👠
	'1F461', // 👡
	'1F462', // 👢
	'1F463', // 👣
	'1F464', // 👤
	'1F465', // 👥
	'1F466', // 👦
	'1F467', // 👧
	'1F468', // 👨
	'1F469', // 👩
	'1F46A', // 👪
	'1F46B', // 👫
	'1F46C', // 👬
	'1F46D', // 👭
	'1F46E', // 👮
	'1F46F', // 👯
	'1F470', // 👰
	'1F471', // 👱
	'1F472', // 👲
	'1F473', // 👳
	'1F474', // 👴
	'1F475', // 👵
	'1F476', // 👶
	'1F477', // 👷
	'1F478', // 👸
	'1F479', // 👹
	'1F47A', // 👺
	'1F47B', // 👻
	'1F47C', // 👼
	'1F47D', // 👽
	'1F47E', // 👾
	'1F47F', // 👿
	'1F480', // 💀
	'1F481', // 💁
	'1F482', // 💂
	'1F483', // 💃
	'1F484', // 💄
	'1F485', // 💅
	'1F486', // 💆
	'1F487', // 💇
	'1F488', // 💈
	'1F489', // 💉
	'1F48A', // 💊
	'1F48B', // 💋
	'1F48C', // 💌
	'1F48D', // 💍
	'1F48E', // 💎
	'1F48F', // 💏
	'1F490', // 💐
	'1F491', // 💑
	'1F492', // 💒
	'1F493', // 💓
	'1F494', // 💔
	'1F495', // 💕
	'1F496', // 💖
	'1F497', // 💗
	'1F498', // 💘
	'1F499', // 💙
	'1F49A', // 💚
	'1F49B', // 💛
	'1F49C', // 💜
	'1F49D', // 💝
	'1F49E', // 💞
	'1F49F', // 💟
	'1F4A0', // 💠
	'1F4A1', // 💡
	'1F4A2', // 💢
	'1F4A3', // 💣
	'1F4A4', // 💤
	'1F4A5', // 💥
	'1F4A6', // 💦
	'1F4A7', // 💧
	'1F4A8', // 💨
	'1F4A9', // 💩
	'1F4AA', // 💪
	'1F4AB', // 💫
	'1F4AC', // 💬
	'1F4AD', // 💭
	'1F4AE', // 💮
	'1F4AF', // 💯
	'1F4B0', // 💰
	'1F4B1', // 💱
	'1F4B2', // 💲
	'1F4B3', // 💳
	'1F4B4', // 💴
	'1F4B5', // 💵
	'1F4B6', // 💶
	'1F4B7', // 💷
	'1F4B8', // 💸
	'1F4B9', // 💹
	'1F4BA', // 💺
	'1F4BB', // 💻
	'1F4BC', // 💼
	'1F4BD', // 💽
	'1F4BE', // 💾
	'1F4BF', // 💿
	'1F4C0', // 📀
	'1F4C1', // 📁
	'1F4C2', // 📂
	'1F4C3', // 📃
	'1F4C4', // 📄
	'1F4C5', // 📅
	'1F4C6', // 📆
	'1F4C7', // 📇
	'1F4C8', // 📈
	'1F4C9', // 📉
	'1F4CA', // 📊
	'1F4CB', // 📋
	'1F4CC', // 📌
	'1F4CD', // 📍
	'1F4CE', // 📎
	'1F4CF', // 📏
	'1F4D0', // 📐
	'1F4D1', // 📑
	'1F4D2', // 📒
	'1F4D3', // 📓
	'1F4D4', // 📔
	'1F4D5', // 📕
	'1F4D6', // 📖
	'1F4D7', // 📗
	'1F4D8', // 📘
	'1F4D9', // 📙
	'1F4DA', // 📚
	'1F4DB', // 📛
	'1F4DC', // 📜
	'1F4DD', // 📝
	'1F4DE', // 📞
	'1F4DF', // 📟
	'1F4E0', // 📠
	'1F4E1', // 📡
	'1F4E2', // 📢
	'1F4E3', // 📣
	'1F4E4', // 📤
	'1F4E5', // 📥
	'1F4E6', // 📦
	'1F4E7', // 📧
	'1F4E8', // 📨
	'1F4E9', // 📩
	'1F4EA', // 📪
	'1F4EB', // 📫
	'1F4EC', // 📬
	'1F4ED', // 📭
	'1F4EE', // 📮
	'1F4EF', // 📯
	'1F4F0', // 📰
	'1F4F1', // 📱
	'1F4F2', // 📲
	'1F4F3', // 📳
	'1F4F4', // 📴
	'1F4F5', // 📵
	'1F4F6', // 📶
	'1F4F7', // 📷
	'1F4F8', // 📸
	'1F4F9', // 📹
	'1F4FA', // 📺
	'1F4FB', // 📻
	'1F4FC', // 📼
	'1F4FD', // 📽
	'1F4FF', // 📿
	'1F500', // 🔀
	'1F501', // 🔁
	'1F502', // 🔂
	'1F503', // 🔃
	'1F504', // 🔄
	'1F505', // 🔅
	'1F506', // 🔆
	'1F507', // 🔇
	'1F508', // 🔈
	'1F509', // 🔉
	'1F50A', // 🔊
	'1F50B', // 🔋
	'1F50C', // 🔌
	'1F50D', // 🔍
	'1F50E', // 🔎
	'1F50F', // 🔏
	'1F510', // 🔐
	'1F511', // 🔑
	'1F512', // 🔒
	'1F513', // 🔓
	'1F514', // 🔔
	'1F515', // 🔕
	'1F516', // 🔖
	'1F517', // 🔗
	'1F518', // 🔘
	'1F519', // 🔙
	'1F51A', // 🔚
	'1F51B', // 🔛
	'1F51C', // 🔜
	'1F51D', // 🔝
	'1F51E', // 🔞
	'1F51F', // 🔟
	'1F520', // 🔠
	'1F521', // 🔡
	'1F522', // 🔢
	'1F523', // 🔣
	'1F524', // 🔤
	'1F525', // 🔥
	'1F526', // 🔦
	'1F527', // 🔧
	'1F528', // 🔨
	'1F529', // 🔩
	'1F52A', // 🔪
	'1F52B', // 🔫
	'1F52C', // 🔬
	'1F52D', // 🔭
	'1F52E', // 🔮
	'1F52F', // 🔯
	'1F530', // 🔰
	'1F531', // 🔱
	'1F532', // 🔲
	'1F533', // 🔳
	'1F534', // 🔴
	'1F535', // 🔵
	'1F536', // 🔶
	'1F537', // 🔷
	'1F538', // 🔸
	'1F539', // 🔹
	'1F53A', // 🔺
	'1F53B', // 🔻
	'1F53C', // 🔼
	'1F53D', // 🔽
	'1F549', // 🕉
	'1F54A', // 🕊
	'1F54B', // 🕋
	'1F54C', // 🕌
	'1F54D', // 🕍
	'1F54E', // 🕎
	'1F550', // 🕐
	'1F551', // 🕑
	'1F552', // 🕒
	'1F553', // 🕓
	'1F554', // 🕔
	'1F555', // 🕕
	'1F556', // 🕖
	'1F557', // 🕗
	'1F558', // 🕘
	'1F559', // 🕙
	'1F55A', // 🕚
	'1F55B', // 🕛
	'1F55C', // 🕜
	'1F55D', // 🕝
	'1F55E', // 🕞
	'1F55F', // 🕟
	'1F560', // 🕠
	'1F561', // 🕡
	'1F562', // 🕢
	'1F563', // 🕣
	'1F564', // 🕤
	'1F565', // 🕥
	'1F566', // 🕦
	'1F567', // 🕧
	'1F56F', // 🕯
	'1F570', // 🕰
	'1F573', // 🕳
	'1F574', // 🕴
	'1F575', // 🕵
	'1F576', // 🕶
	'1F577', // 🕷
	'1F578', // 🕸
	'1F579', // 🕹
	'1F57A', // 🕺
	'1F587', // 🖇
	'1F58A', // 🖊
	'1F58B', // 🖋
	'1F58C', // 🖌
	'1F58D', // 🖍
	'1F590', // 🖐
	'1F595', // 🖕
	'1F596', // 🖖
	'1F5A4', // 🖤
	'1F5A5', // 🖥
	'1F5A8', // 🖨
	'1F5B1', // 🖱
	'1F5B2', // 🖲
	'1F5BC', // 🖼
	'1F5C2', // 🗂
	'1F5C3', // 🗃
	'1F5C4', // 🗄
	'1F5D1', // 🗑
	'1F5D2', // 🗒
	'1F5D3', // 🗓
	'1F5DC', // 🗜
	'1F5DD', // 🗝
	'1F5DE', // 🗞
	'1F5E1', // 🗡
	'1F5E3', // 🗣
	'1F5E8', // 🗨
	'1F5EF', // 🗯
	'1F5F3', // 🗳
	'1F5FA', // 🗺
	'1F5FB', // 🗻
	'1F5FC', // 🗼
	'1F5FD', // 🗽
	'1F5FE', // 🗾
	'1F5FF', // 🗿
	'1F600', // 😀
	'1F601', // 😁
	'1F602', // 😂
	'1F603', // 😃
	'1F604', // 😄
	'1F605', // 😅
	'1F606', // 😆
	'1F607', // 😇
	'1F608', // 😈
	'1F609', // 😉
	'1F60A', // 😊
	'1F60B', // 😋
	'1F60C', // 😌
	'1F60D', // 😍
	'1F60E', // 😎
	'1F60F', // 😏
	'1F610', // 😐
	'1F611', // 😑
	'1F612', // 😒
	'1F613', // 😓
	'1F614', // 😔
	'1F615', // 😕
	'1F616', // 😖
	'1F617', // 😗
	'1F618', // 😘
	'1F619', // 😙
	'1F61A', // 😚
	'1F61B', // 😛
	'1F61C', // 😜
	'1F61D', // 😝
	'1F61E', // 😞
	'1F61F', // 😟
	'1F620', // 😠
	'1F621', // 😡
	'1F622', // 😢
	'1F623', // 😣
	'1F624', // 😤
	'1F625', // 😥
	'1F626', // 😦
	'1F627', // 😧
	'1F628', // 😨
	'1F629', // 😩
	'1F62A', // 😪
	'1F62B', // 😫
	'1F62C', // 😬
	'1F62D', // 😭
	'1F62E', // 😮
	'1F62F', // 😯
	'1F630', // 😰
	'1F631', // 😱
	'1F632', // 😲
	'1F633', // 😳
	'1F634', // 😴
	'1F635', // 😵
	'1F636', // 😶
	'1F637', // 😷
	'1F638', // 😸
	'1F639', // 😹
	'1F63A', // 😺
	'1F63B', // 😻
	'1F63C', // 😼
	'1F63D', // 😽
	'1F63E', // 😾
	'1F63F', // 😿
	'1F640', // 🙀
	'1F641', // 🙁
	'1F642', // 🙂
	'1F643', // 🙃
	'1F644', // 🙄
	'1F645', // 🙅
	'1F646', // 🙆
	'1F647', // 🙇
	'1F648', // 🙈
	'1F649', // 🙉
	'1F64A', // 🙊
	'1F64B', // 🙋
	'1F64C', // 🙌
	'1F64D', // 🙍
	'1F64E', // 🙎
	'1F64F', // 🙏
	'1F680', // 🚀
	'1F681', // 🚁
	'1F682', // 🚂
	'1F683', // 🚃
	'1F684', // 🚄
	'1F685', // 🚅
	'1F686', // 🚆
	'1F687', // 🚇
	'1F688', // 🚈
	'1F689', // 🚉
	'1F68A', // 🚊
	'1F68B', // 🚋
	'1F68C', // 🚌
	'1F68D', // 🚍
	'1F68E', // 🚎
	'1F68F', // 🚏
	'1F690', // 🚐
	'1F691', // 🚑
	'1F692', // 🚒
	'1F693', // 🚓
	'1F694', // 🚔
	'1F695', // 🚕
	'1F696', // 🚖
	'1F697', // 🚗
	'1F698', // 🚘
	'1F699', // 🚙
	'1F69A', // 🚚
	'1F69B', // 🚛
	'1F69C', // 🚜
	'1F69D', // 🚝
	'1F69E', // 🚞
	'1F69F', // 🚟
	'1F6A0', // 🚠
	'1F6A1', // 🚡
	'1F6A2', // 🚢
	'1F6A3', // 🚣
	'1F6A4', // 🚤
	'1F6A5', // 🚥
	'1F6A6', // 🚦
	'1F6A7', // 🚧
	'1F6A8', // 🚨
	'1F6A9', // 🚩
	'1F6AA', // 🚪
	'1F6AB', // 🚫
	'1F6AC', // 🚬
	'1F6AD', // 🚭
	'1F6AE', // 🚮
	'1F6AF', // 🚯
	'1F6B0', // 🚰
	'1F6B1', // 🚱
	'1F6B2', // 🚲
	'1F6B3', // 🚳
	'1F6B4', // 🚴
	'1F6B5', // 🚵
	'1F6B6', // 🚶
	'1F6B7', // 🚷
	'1F6B8', // 🚸
	'1F6B9', // 🚹
	'1F6BA', // 🚺
	'1F6BB', // 🚻
	'1F6BC', // 🚼
	'1F6BD', // 🚽
	'1F6BE', // 🚾
	'1F6BF', // 🚿
	'1F6C0', // 🛀
	'1F6C1', // 🛁
	'1F6C2', // 🛂
	'1F6C3', // 🛃
	'1F6C4', // 🛄
	'1F6C5', // 🛅
	'1F6CB', // 🛋
	'1F6CC', // 🛌
	'1F6CD', // 🛍
	'1F6CE', // 🛎
	'1F6CF', // 🛏
	'1F6D0', // 🛐
	'1F6D1', // 🛑
	'1F6D2', // 🛒
	'1F6D5', // 🛕
	'1F6D6', // 🛖
	'1F6D7', // 🛗
	'1F6DD', // 🛝
	'1F6DE', // 🛞
	'1F6DF', // 🛟
	'1F6E0', // 🛠
	'1F6E1', // 🛡
	'1F6E2', // 🛢
	'1F6E3', // 🛣
	'1F6E4', // 🛤
	'1F6E5', // 🛥
	'1F6E9', // 🛩
	'1F6EB', // 🛫
	'1F6EC', // 🛬
	'1F6F0', // 🛰
	'1F6F3', // 🛳
	'1F6F4', // 🛴
	'1F6F5', // 🛵
	'1F6F6', // 🛶
	'1F6F7', // 🛷
	'1F6F8', // 🛸
	'1F6F9', // 🛹
	'1F6FA', // 🛺
	'1F6FB', // 🛻
	'1F6FC', // 🛼
	'1F7E0', // 🟠
	'1F7E1', // 🟡
	'1F7E2', // 🟢
	'1F7E3', // 🟣
	'1F7E4', // 🟤
	'1F7E5', // 🟥
	'1F7E6', // 🟦
	'1F7E7', // 🟧
	'1F7E8', // 🟨
	'1F7E9', // 🟩
	'1F7EA', // 🟪
	'1F7EB', // 🟫
	'1F7F0', // 🟰
	'1F90C', // 🤌
	'1F90D', // 🤍
	'1F90E', // 🤎
	'1F90F', // 🤏
	'1F910', // 🤐
	'1F911', // 🤑
	'1F912', // 🤒
	'1F913', // 🤓
	'1F914', // 🤔
	'1F915', // 🤕
	'1F916', // 🤖
	'1F917', // 🤗
	'1F918', // 🤘
	'1F919', // 🤙
	'1F91A', // 🤚
	'1F91B', // 🤛
	'1F91C', // 🤜
	'1F91D', // 🤝
	'1F91E', // 🤞
	'1F91F', // 🤟
	'1F920', // 🤠
	'1F921', // 🤡
	'1F922', // 🤢
	'1F923', // 🤣
	'1F924', // 🤤
	'1F925', // 🤥
	'1F926', // 🤦
	'1F927', // 🤧
	'1F928', // 🤨
	'1F929', // 🤩
	'1F92A', // 🤪
	'1F92B', // 🤫
	'1F92C', // 🤬
	'1F92D', // 🤭
	'1F92E', // 🤮
	'1F92F', // 🤯
	'1F930', // 🤰
	'1F931', // 🤱
	'1F932', // 🤲
	'1F933', // 🤳
	'1F934', // 🤴
	'1F935', // 🤵
	'1F936', // 🤶
	'1F937', // 🤷
	'1F938', // 🤸
	'1F939', // 🤹
	'1F93A', // 🤺
	'1F93C', // 🤼
	'1F93D', // 🤽
	'1F93E', // 🤾
	'1F93F', // 🤿
	'1F940', // 🥀
	'1F941', // 🥁
	'1F942', // 🥂
	'1F943', // 🥃
	'1F944', // 🥄
	'1F945', // 🥅
	'1F947', // 🥇
	'1F948', // 🥈
	'1F949', // 🥉
	'1F94A', // 🥊
	'1F94B', // 🥋
	'1F94C', // 🥌
	'1F94D', // 🥍
	'1F94E', // 🥎
	'1F94F', // 🥏
	'1F950', // 🥐
	'1F951', // 🥑
	'1F952', // 🥒
	'1F953', // 🥓
	'1F954', // 🥔
	'1F955', // 🥕
	'1F956', // 🥖
	'1F957', // 🥗
	'1F958', // 🥘
	'1F959', // 🥙
	'1F95A', // 🥚
	'1F95B', // 🥛
	'1F95C', // 🥜
	'1F95D', // 🥝
	'1F95E', // 🥞
	'1F95F', // 🥟
	'1F960', // 🥠
	'1F961', // 🥡
	'1F962', // 🥢
	'1F963', // 🥣
	'1F964', // 🥤
	'1F965', // 🥥
	'1F966', // 🥦
	'1F967', // 🥧
	'1F968', // 🥨
	'1F969', // 🥩
	'1F96A', // 🥪
	'1F96B', // 🥫
	'1F96C', // 🥬
	'1F96D', // 🥭
	'1F96E', // 🥮
	'1F96F', // 🥯
	'1F970', // 🥰
	'1F971', // 🥱
	'1F972', // 🥲
	'1F973', // 🥳
	'1F974', // 🥴
	'1F975', // 🥵
	'1F976', // 🥶
	'1F977', // 🥷
	'1F978', // 🥸
	'1F979', // 🥹
	'1F97A', // 🥺
	'1F97B', // 🥻
	'1F97C', // 🥼
	'1F97D', // 🥽
	'1F97E', // 🥾
	'1F97F', // 🥿
	'1F980', // 🦀
	'1F981', // 🦁
	'1F982', // 🦂
	'1F983', // 🦃
	'1F984', // 🦄
	'1F985', // 🦅
	'1F986', // 🦆
	'1F987', // 🦇
	'1F988', // 🦈
	'1F989', // 🦉
	'1F98A', // 🦊
	'1F98B', // 🦋
	'1F98C', // 🦌
	'1F98D', // 🦍
	'1F98E', // 🦎
	'1F98F', // 🦏
	'1F990', // 🦐
	'1F991', // 🦑
	'1F992', // 🦒
	'1F993', // 🦓
	'1F994', // 🦔
	'1F995', // 🦕
	'1F996', // 🦖
	'1F997', // 🦗
	'1F998', // 🦘
	'1F999', // 🦙
	'1F99A', // 🦚
	'1F99B', // 🦛
	'1F99C', // 🦜
	'1F99D', // 🦝
	'1F99E', // 🦞
	'1F99F', // 🦟
	'1F9A0', // 🦠
	'1F9A1', // 🦡
	'1F9A2', // 🦢
	'1F9A3', // 🦣
	'1F9A4', // 🦤
	'1F9A5', // 🦥
	'1F9A6', // 🦦
	'1F9A7', // 🦧
	'1F9A8', // 🦨
	'1F9A9', // 🦩
	'1F9AA', // 🦪
	'1F9AB', // 🦫
	'1F9AC', // 🦬
	'1F9AD', // 🦭
	'1F9AE', // 🦮
	'1F9AF', // 🦯
	'1F9B0', // 🦰
	'1F9B1', // 🦱
	'1F9B2', // 🦲
	'1F9B3', // 🦳
	'1F9B4', // 🦴
	'1F9B5', // 🦵
	'1F9B6', // 🦶
	'1F9B7', // 🦷
	'1F9B8', // 🦸
	'1F9B9', // 🦹
	'1F9BA', // 🦺
	'1F9BB', // 🦻
	'1F9BC', // 🦼
	'1F9BD', // 🦽
	'1F9BE', // 🦾
	'1F9BF', // 🦿
	'1F9C0', // 🧀
	'1F9C1', // 🧁
	'1F9C2', // 🧂
	'1F9C3', // 🧃
	'1F9C4', // 🧄
	'1F9C5', // 🧅
	'1F9C6', // 🧆
	'1F9C7', // 🧇
	'1F9C8', // 🧈
	'1F9C9', // 🧉
	'1F9CA', // 🧊
	'1F9CB', // 🧋
	'1F9CC', // 🧌
	'1F9CD', // 🧍
	'1F9CE', // 🧎
	'1F9CF', // 🧏
	'1F9D0', // 🧐
	'1F9D1', // 🧑
	'1F9D2', // 🧒
	'1F9D3', // 🧓
	'1F9D4', // 🧔
	'1F9D5', // 🧕
	'1F9D6', // 🧖
	'1F9D7', // 🧗
	'1F9D8', // 🧘
	'1F9D9', // 🧙
	'1F9DA', // 🧚
	'1F9DB', // 🧛
	'1F9DC', // 🧜
	'1F9DD', // 🧝
	'1F9DE', // 🧞
	'1F9DF', // 🧟
	'1F9E0', // 🧠
	'1F9E1', // 🧡
	'1F9E2', // 🧢
	'1F9E3', // 🧣
	'1F9E4', // 🧤
	'1F9E5', // 🧥
	'1F9E6', // 🧦
	'1F9E7', // 🧧
	'1F9E8', // 🧨
	'1F9E9', // 🧩
	'1F9EA', // 🧪
	'1F9EB', // 🧫
	'1F9EC', // 🧬
	'1F9ED', // 🧭
	'1F9EE', // 🧮
	'1F9EF', // 🧯
	'1F9F0', // 🧰
	'1F9F1', // 🧱
	'1F9F2', // 🧲
	'1F9F3', // 🧳
	'1F9F4', // 🧴
	'1F9F5', // 🧵
	'1F9F6', // 🧶
	'1F9F7', // 🧷
	'1F9F8', // 🧸
	'1F9F9', // 🧹
	'1F9FA', // 🧺
	'1F9FB', // 🧻
	'1F9FC', // 🧼
	'1F9FD', // 🧽
	'1F9FE', // 🧾
	'1F9FF', // 🧿
	'1FA70', // 🩰
	'1FA71', // 🩱
	'1FA72', // 🩲
	'1FA73', // 🩳
	'1FA74', // 🩴
	'1FA78', // 🩸
	'1FA79', // 🩹
	'1FA7A', // 🩺
	'1FA7B', // 🩻
	'1FA7C', // 🩼
	'1FA80', // 🪀
	'1FA81', // 🪁
	'1FA82', // 🪂
	'1FA83', // 🪃
	'1FA84', // 🪄
	'1FA85', // 🪅
	'1FA86', // 🪆
	'1FA90', // 🪐
	'1FA91', // 🪑
	'1FA92', // 🪒
	'1FA93', // 🪓
	'1FA94', // 🪔
	'1FA95', // 🪕
	'1FA96', // 🪖
	'1FA97', // 🪗
	'1FA98', // 🪘
	'1FA99', // 🪙
	'1FA9A', // 🪚
	'1FA9B', // 🪛
	'1FA9C', // 🪜
	'1FA9D', // 🪝
	'1FA9E', // 🪞
	'1FA9F', // 🪟
	'1FAA0', // 🪠
	'1FAA1', // 🪡
	'1FAA2', // 🪢
	'1FAA3', // 🪣
	'1FAA4', // 🪤
	'1FAA5', // 🪥
	'1FAA6', // 🪦
	'1FAA7', // 🪧
	'1FAA8', // 🪨
	'1FAA9', // 🪩
	'1FAAA', // 🪪
	'1FAAB', // 🪫
	'1FAAC', // 🪬
	'1FAB0', // 🪰
	'1FAB1', // 🪱
	'1FAB2', // 🪲
	'1FAB3', // 🪳
	'1FAB4', // 🪴
	'1FAB5', // 🪵
	'1FAB6', // 🪶
	'1FAB7', // 🪷
	'1FAB8', // 🪸
	'1FAB9', // 🪹
	'1FABA', // 🪺
	'1FAC0', // 🫀
	'1FAC1', // 🫁
	'1FAC2', // 🫂
	'1FAC3', // 🫃
	'1FAC4', // 🫄
	'1FAC5', // 🫅
	'1FAD0', // 🫐
	'1FAD1', // 🫑
	'1FAD2', // 🫒
	'1FAD3', // 🫓
	'1FAD4', // 🫔
	'1FAD5', // 🫕
	'1FAD6', // 🫖
	'1FAD7', // 🫗
	'1FAD8', // 🫘
	'1FAD9', // 🫙
	'1FAE0', // 🫠
	'1FAE1', // 🫡
	'1FAE2', // 🫢
	'1FAE3', // 🫣
	'1FAE4', // 🫤
	'1FAE5', // 🫥
	'1FAE6', // 🫦
	'1FAE7', // 🫧
	'1FAF0', // 🫰
	'1FAF1', // 🫱
	'1FAF2', // 🫲
	'1FAF3', // 🫳
	'1FAF4', // 🫴
	'1FAF5', // 🫵
	'1FAF6', // 🫶
]
```