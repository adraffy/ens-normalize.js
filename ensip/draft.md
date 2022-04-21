# ENSIP-?: Standardization of ENS Name Normalization 

| **Author**  | Andrew Raffensperger \<raffy@me.com> |
| ----------- | ------------------------------------ |
| **Status**  | Draft                                |
| **Created** | 2022-04-20                           |

## Abstract

This ENSIP standardizes, versions, and resolves implementation details of the Ethereum Name Service (ENS) name normalization process outlined in [ENSIP-1 § Name Syntax](https://docs.ens.domains/ens-improvement-proposals/ensip-1-ens#name-syntax).  Since ENSIP-1 was finalized in 2016, Unicode has [evolved](https://unicode.org/history/publicationdates.html) from version 8.0.0 to 14.0.0 and incorporated many new characters, including complex emoji sequences.

The goal of this ENSIP to standardize the exact normalization algorithm, pin an explicit Unicode verison, and elucidate many implementation details and edge cases.  This ENSIP introduces an explicit set of modifications to the existing standard to reduce visually-confusing names and improve compatibility with future Unicode updates.  Additionally, a test set of 

As of this ENSIP, over 580K names have been registered on chain.  Great effort has been made to preserve as many names as possible, however some names will become unreachable if the normalization outlined in this ENSIP is applied.

## Motivation

* Since ENSIP-1, Unicode has evolved from version 8.0.0 to 14.0.0 (6 major bumps) and ENSIP does not state an explicit version number. 

* ENSIP-1 implies but does not state an explicit flavor of IDNA processing. 

* Unicode support is non-uniform across all platforms, including language-level String functions, like [Unicode Normalization Form C](https://unicode.org/reports/tr15/).

* [UTS-46](https://unicode.org/reports/tr46/) is insufficient to correctly normalize emoji. Correct emoji parsing is only possible with [UTS-51](https://www.unicode.org/reports/tr51/).

* There does not exist a validation set of unormalized and normalized names.

* The success of ENS has encouraged spoofing&mdash;registering a visually similar name with exotic characters&mdash;via the following techniques:

	* Insertion of Zero-width Characters
	* Replacement of Look-alike (Confusable) Characters
	* Using names which normalize differently between available algorithms 


## Specification

* Normalization is the process of converting an arbitrary string into a canonical form.  

* It is idempotent:  applying normalization mutliple times produces the same result.

* It either produces a string or throws an error.

* The Unicode version is `14.0.0`

* Input is processed left-to-right, first looking for emoji sequences according to [UTS-51](https://unicode.org/reports/tr51/), and then text sequences according to [UTS-46](https://unicode.org/reports/tr46/).  

* UTS-51 parsing has the following **<u>changes</u>**:
	* <a href="#WhiteSEQ">Whitelisted sequences</a> are matched first.
    * `FE0E` is never matched.
    * <a href="#Demoji">A small set of emoji</a> are demoted from emoji because they were disallowed or mapped by legacy IDNA 2003 logic:  
        * `[0-9] FE0F` was normalized to `[0-9]` which is ambiguous with the corresponding digit character.
        * `[#*] FE0F` was normalized to `[#*]` which is disallowed.
        * Some emoji were mapped to non-emoji sequences.
	* [Tag Sequences](https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence) are disallowed (because they hide arbitrary data.)
	* [Flag Sequences](https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence) are ignored and singleton *Regional Indicators* are allowed. 
	* [Keycap Sequences](https://www.unicode.org/reports/tr51/#def_emoji_keycap_sequence) have a special case to account for legacy normalization:
		* `[0-9] FE0F? 20E3` (where `FE0F` is optional) is parsed as `[0-9] 20E3`
		* `[#*] FE0F 20E3` is parsed verbatim
	* [Presentation Sequences](https://www.unicode.org/reports/tr51/#def_emoji_presentation_sequence) have a special case to account for legacy normalization:
        * `$REQ FE0F` is parsed verbatim<br>where `$REQ = [203C, 2049]` is the set of all new and future emoji.
        * `$DROP FE0F?` (where `FE0F` is optional) is parsed as `$DROP`<br>where `$DROP` is the set of all emoji that were valid in IDNA 2003.
    * [ZWJ Sequences](https://www.unicode.org/reports/tr51/#def_emoji_zwj_sequence) are either:
		* [RGI Sequences](https://unicode.org/Public/emoji/14.0/emoji-zwj-sequences.txt)
		* <a href="#WhiteNonRGI">Whitelisted Non-RGI Sequences</a>
    
	
* UTS-46 parsing has the following settings or **<u>changes</u>**:
    * *UseSTD3ASCIIRules* is `true`
    * *Transitional* is `false`
        * IDNA 2008 
        * Deviations are Valid
        * Includes NV8 and XV8
    * *CheckHyphens* is `true`
    * *CheckBidi* is `true`
    * *CheckJoiners* is `true` and uses *ContextJ* and *ContextO* rules
    * The following characters are disallowed: 
        * `(。) 3002 Ideographic Full Stop`
        * `(．) FF0E Fullwidth Full Stop`
        * `(｡) FF61 Halfwidth Ideographic Full Stop`
        * `(◌̲) 0332 Combining Low Line`
    * The following characters are allowed:
        * `(_) 005F Underscore`
        * `($) 0024 Dollar Sign`
        * `(£) 0024 Pound Sign`
        * `(¥) 00A5 Yen Sign`
        * `(€) 20AC Euro Sign`
        * `(₿) 20BF Bitcoin Sign`

* Like ENSIP-1, labels are formed from runs of emoji and text separated by a stop character.  The only valid stop character is ASCII period: `002E (.) FULL STOP`

* Each label 


## Algorithm

// todo

## Appendix: Reference Specifications

* [ENSIP-1: ENS](https://docs.ens.domains/ens-improvement-proposals/ensip-1-ens)
* [UTS-46: IDNA Compatibility Processing](https://unicode.org/reports/tr46/)
* [UTS-51: Emoji](https://www.unicode.org/reports/tr51)
* [UTS-39: Security Mechanisms](https://www.unicode.org/reports/tr39/)
* [RFC-5892: IDNA](https://datatracker.ietf.org/doc/html/rfc5892)
* [RFC-3492: Punycode](https://datatracker.ietf.org/doc/html/rfc3492)
* [UAX-15: Normalization Forms](https://unicode.org/reports/tr15/)

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
	"", // empty
	".", // null labels
	".eth", // null labels
	"..eth", // null labels
	"vitalik.eth",
	"brantly.cash", // non-eth tld
	"öbb.at",
	"nowzad.loopring.eth", // subdomain
	"ß.eth", // deviation
	"ς.eth", // deviation
	"te_t.eth", // allowed underscore
	"te$t.eth", // allowed dollar
	"🚀🚀🚀.eth", 
	"💩💩💩.eth",
	"🌈rainbow.eth", // emoji + text
	"#️⃣*️⃣.eth", // modern keycap
	"🧟‍♂.eth", // zombie
	"🧟♂.eth",  // zombie w/gender
	"😵💫😵💫😵💫.eth", // no zwj
	"😵‍💫😵‍💫😵‍💫.eth", // zwj seq,
	"🏴.eth", // solo flag
	"🏴󠁧󠁢󠁥󠁮󠁧󠁿.eth", // whitelisted seq
	"🏴󠁧󠁢󠁳󠁣󠁴󠁿.eth", 
	"🏴󠁧󠁢󠁷󠁬󠁳󠁿.eth",
	"a्‌.eth", // ContextJ: ZWNJ Rule 1
	"ࡃ࣭‌߲ܓ.eth", // ContextJ: ZWNJ Rule 2
	"a्‍.eth", // ContextJ: ZWJ
	"l·l.eth", // ContextO: Middle Dot
	"ab͵ͷ.eth", // ContextO: Greek Keraia
	"ב֑׳.eth", // ContextO: Hebrew Geresh
	"ぁァ・.eth", // ContextO: Katakana
	"א٠١٢.eth", // ContextO: [Arabic]-Indic
	"א۰۱۲.eth", // ContextO: Arabic-[Indic]
	"פעילותהבינאום.eth", // CheckBidi
	"ކޮންޕީޓަރު.eth", // CheckBidi: Dhivehi
	"יִואָ.eth", // CheckBidi: Yiddish,
	"bahrain.مصر", // CheckBidi: separate LTR and RTL
	"🇸🇦سلمان.eth", // CheckBidi: emoji + RTL 
	"‼️‼️‼️.eth",
	"⁉️⁉️⁉️.eth"
]
```
### Expect Pass: Transformed
```Javascript
[
	{name: "bRAnTlY.eTh", norm: "brantly.eth"}, // mapping
	{name: "xn--ls8h.eth", norm: "💩.eth"}, // punycode
	{name: "xn--bb-eka.eth", norm: "öbb.eth"},  // punycode
	{name: "Ⅷ", norm: "viii"}, // IDNA mapping
	{name: "︎\u{FE0E}.eth", norm: ".eth"}, // ignored emoji w/text styling
	{name: "Öbb.at", norm: "öbb.at"}, 
	{name: "🚴‍♂️.eth", norm: "🚴‍♂.eth"}, // drop FE0F
	{name: "🏳️‍🌈.eth", norm: "🏳‍🌈.eth"},
	{name: "👩🏽‍⚕️.eth", norm: "👩🏽‍⚕.eth"},
	{name: "👁️‍🗨️.eth", norm: "👁‍🗨.eth"}, // drop 2x FE0F
	{name: "6️⃣9️⃣.eth", norm: "6⃣9⃣.eth"}, // legacy keycaps,
	{name: "ⓂⓂⓂ.eth", norm: "mmm.eth"}, // mapping
	{name: "Ⓜ️Ⓜ️Ⓜ️.eth", norm: "mmm.eth"}, // mapping
]
```
### Expect Fail
```Javascript
[
	"◌̈bb.at",
	"💩‍💩.eth", // poop joiner
	"🏴󠁷󠁴󠁦󠁿.eth", // invalid tag sequence

	"🅜🅜🅜.eth", 
	"🅼🅼🅼.eth", 
	"❻❻❻.eth",
	"➏➏➏.eth",
	"te[st.eth",

	"te--st.eth", // CheckHyphens: Section 4.1 Rule #2	
	"test-.eth", // CheckHyphens: Section 4.1 Rule #3A
	"-test.eth", // CheckHyphens: Section 4.1 Rule #3B

	"test\u{FF0E}eth", // Disallowed Alternative Stops
	"test\u{3002}eth", // Disallowed Alternative Stops
	"test\u{FF61}eth", // Disallowed Alternative Stops

	"a‌b.eth", // ContextJ: ZWNJ Rule 2
	"🧞‌‌.eth", // ContextJ: ZWNJ
	"a‍b.eth", // ContextJ: ZWJ
	"a·b.eth", // ContextO: Middle Dot
	"ab͵.eth", // ContextO: Greek Keraia
	"ab׳.eth", // ContextO: Hebrew Geresh
	"ab・.eth", // ContextO: Katakana
	"٠۰.eth", // ContextO: Arabic-Indic

	"\u{202E}elgoog\u{202D}.eth", // CheckBidi: direction modifier
	"\u{202E}hte.elgoog", // CheckBidi: direction modifier
	"bahrainمصر.eth", // CheckBidi: mixed LTR+RTL
]
```

## Appendix: Datasets 

<a name="#WhiteSEQ"></a>
### Whitelisted Emoji Sequences
```Javascript
[
	'1F3F4 E0067 E0062 E0065 E006E E0067 E007F', // 🏴󠁧󠁢󠁥󠁮󠁧󠁿
	'1F3F4 E0067 E0062 E0073 E0063 E0074 E007F', // 🏴󠁧󠁢󠁳󠁣󠁴󠁿
	'1F3F4 E0067 E0062 E0077 E006C E0073 E007F', // 🏴󠁧󠁢󠁷󠁬󠁳󠁿
]
```

<a name="#WhiteNonRGI"></a>
### Whitelisted Non-RGI Emoji Sequences
```Javascript
[
	'1F93C 1F3FB 200D 2640',
	'1F93C 1F3FC 200D 2640',
	'1F93C 1F3FD 200D 2640',
	'1F93C 1F3FE 200D 2640',
	'1F93C 1F3FF 200D 2640',
]
```

<a name="#Demoji"></a>
### Demoted Emoji Characters
```Javascript
// src -> dst => IDNA mapped 
// src (only) => IDNA valid 
[
	{src: '2122', dst: '74 6D'}, // ™ -> tm
	{src: '2139', dst: '69'}, // ℹ -> i
	{src: '24C2', dst: '6D'}, // Ⓜ -> m
	{src: '3297', dst: '795D'}, // ㊗ -> 祝
	{src: '3299', dst: '79D8'}, // ㊙ -> 秘
	{src: '1F201', dst: '30B3 30B3'}, // 🈁 -> ココ
	{src: '1F202', dst: '30B5'}, // 🈂 -> サ
	{src: '1F21A', dst: '7121'}, // 🈚 -> 無
	{src: '1F22F', dst: '6307'}, // 🈯 -> 指
	{src: '1F232', dst: '7981'}, // 🈲 -> 禁
	{src: '1F233', dst: '7A7A'}, // 🈳 -> 空
	{src: '1F234', dst: '5408'}, // 🈴 -> 合
	{src: '1F235', dst: '6E80'}, // 🈵 -> 満
	{src: '1F236', dst: '6709'}, // 🈶 -> 有
	{src: '1F237', dst: '6708'}, // 🈷 -> 月
	{src: '1F238', dst: '7533'}, // 🈸 -> 申
	{src: '1F239', dst: '5272'}, // 🈹 -> 割
	{src: '1F23A', dst: '55B6'}, // 🈺 -> 営
	{src: '1F250', dst: '5F97'}, // 🉐 -> 得
	{src: '1F251', dst: '53EF'}, // 🉑 -> 可
	
	{src: '203C'}, // ‼
	{src: '2049'}, // ⁉

	{src: '23'}, // #
	{src: '2A'}, // *
	{src: '30'}, // 0
	{src: '31'}, // 1
	{src: '32'}, // 2
	{src: '33'}, // 3
	{src: '34'}, // 4
	{src: '35'}, // 5
	{src: '36'}, // 6
	{src: '37'}, // 7
	{src: '38'}, // 8
	{src: '39'}, // 9
]
```