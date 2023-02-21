export default [

	// arabic numerals
	// https://discuss.ens.domains/t/ens-name-normalization/8652/172
	[0x6F0, [0x660]], // 6F0 (۰) EXTENDED ARABIC-INDIC DIGIT ZERO  => 660 (٠) ARABIC-INDIC DIGIT ZERO
	[0x6F1, [0x661]], // 6F1 (۱) EXTENDED ARABIC-INDIC DIGIT ONE   => 661 (١) ARABIC-INDIC DIGIT ONE
	[0x6F2, [0x662]], // 6F2 (۲) EXTENDED ARABIC-INDIC DIGIT TWO   => 662 (٢) ARABIC-INDIC DIGIT TWO
	[0x6F3, [0x663]], // 6F3 (۳) EXTENDED ARABIC-INDIC DIGIT THREE => 663 (٣) ARABIC-INDIC DIGIT THREE
	[0x6F7, [0x667]], // 6F7 (۷) EXTENDED ARABIC-INDIC DIGIT SEVEN => 667 (٧) ARABIC-INDIC DIGIT SEVEN
	[0x6F8, [0x668]], // 6F8 (۸) EXTENDED ARABIC-INDIC DIGIT EIGHT => 668 (٨) ARABIC-INDIC DIGIT EIGHT
	[0x6F9, [0x669]], // 6F9 (۹) EXTENDED ARABIC-INDIC DIGIT NINE  => 669 (٩) ARABIC-INDIC DIGIT NINE

	// huh? why does IDNA incorrectly map this deviation
	// 00DF ; deviation ; 0073 0073 # 1.1  LATIN SMALL LETTER SHARP S
	// 1E9E ; mapped    ; 0073 0073 # 5.1  LATIN CAPITAL LETTER SHARP S
	// 20221016: this is bad idea, should just disallow
	//[0x1E9E, [0xDF]], // (ẞ) LATIN CAPITAL LETTER SHARP S => (ß) LATIN SMALL LETTER SHARP S 

	// emoji convenience
	// 20221005: this is actually a bad idea
	//[0x203C, [0x2757, 0x2757]], // (‼️) double exclamation mark   => ❗+❗
	//[0x2049, [0x2757, 0x2753]], // (⁉️) exclamation question mark => ❗+❓

	// hyphen-likes
	// https://discuss.ens.domains/t/ens-name-normalization/8652/348
	// https://discuss.ens.domains/t/ens-name-normalization/8652/393
	// https://discuss.ens.domains/t/ens-name-normalization/8652/396
	[0x2010, [0x2D]], // (‐) HYPHEN
	[0x2011, [0x2D]], // (‑) NON-BREAKING HYPHEN
	[0x2012, [0x2D]], // (‒) FIGURE DASH
	[0x2013, [0x2D]], // (–) EN DASH
	[0x2014, [0x2D]], // (—) EM DASH
	[0x2015, [0x2D]], // (―) HORIZONTAL BAR
	[0x2212, [0x2D]], // (−) MINUS SIGN
	//[0x2027, [0x2D]], // (‧) HYPHENATION POINT (too small)
	[0x2043, [0x2D]], // (⁃) HYPHEN BULLET 
	[0xFE58, [0x2D]], // (﹘) SMALL EM DASH	
	// 20221009: the following are too dangerous to map
	//[0x207B, [0x2D]], // (⁻) SUPERSCRIPT MINUS
	//[0x208B, [0x2D]], // (₋) SUBSCRIPT MINUS
	//[0xFE31, [0x2D]], // (︱) PRESENTATION FORM FOR VERTICAL EM DASH
	//[0xFE32, [0x2D]], // (︲) PRESENTATION FORM FOR VERTICAL EN DASH
	// 20221014: better to disallow
	//[0x23BA, [0x2D]], // (⎺) HORIZONTAL SCAN LINE-1
	//[0x23BB, [0x2D]], // (⎻) HORIZONTAL SCAN LINE-3
	//[0x23BC, [0x2D]], // (⎼) HORIZONTAL SCAN LINE-7
	//[0x23BD, [0x2D]], // (⎽) HORIZONTAL SCAN LINE-9
	[0x23E4, [0x2D]], // (⏤) STRAIGHTNESS
	[0x23AF, [0x2D]], // (⎯) HORIZONTAL LINE EXTENSION
	[0x2E3A, [0x2D, 0x2D]], // (⸺) TWO-EM DASH (20221018: added multiples)
	[0x2E3B, [0x2D, 0x2D, 0x2D]], // (⸻) THREE-EM DASH

	// scripted hyphens
	// 20221018: disallowed instead
	// 0x1806, // (᠆) MONGOLIAN TODO SOFT HYPHEN (idna disallowed)
	//[0x58A, [0x2D]], // (֊) ARMENIAN HYPHEN (not sure)
	// 10EAD (𐺭) YEZIDI HYPHENATION MARK // i'm not sure what this is
	//[0x5BE, [0x2D]], // (־) HEBREW PUNCTUATION MAQAF

	// double hyphens
	// 20221018: these should just be disallowed instead
	//[0x2E5D, [0x2D]], // (⹝) OBLIQUE HYPHEN
	//[0x2E17, [0x2D]], // (⸗) DOUBLE OBLIQUE HYPHEN]
	//[0x1400, [0x2D]], // (᐀) CANADIAN SYLLABICS HYPHEN	
	//[0x30A0, [0x2D]], // (゠) KATAKANA-HIRAGANA DOUBLE HYPHEN

	// apostrophe convenience 
	// https://discuss.ens.domains/t/ens-name-normalization/8652/403
	[0x27, [0x2019]], // 27 (') APOSTROPHE => 2019 (’) RIGHT SINGLE QUOTATION MARK
	

	// https://discuss.ens.domains/t/ens-name-normalization/8652/417
	// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/53
	// 20230220: according to breakdown reports, there are very few of these
	// since i couldn't get much feedback regarding this change
	// i will disallow so a decision can be made later
	// (these numbers might be useful for sports)
	/*
	// negative circled => digits
	[0x24FF, [0x30]], // (⓿) NEGATIVE CIRCLED DIGIT ZERO
	[0x24EB, [0x31, 0x31]], // (⓫) NEGATIVE CIRCLED NUMBER ELEVEN
	[0x24EC, [0x31, 0x32]], // (⓬) NEGATIVE CIRCLED NUMBER TWELVE
	[0x24ED, [0x31, 0x33]], // (⓭) NEGATIVE CIRCLED NUMBER THIRTEEN
	[0x24EE, [0x31, 0x34]], // (⓮) NEGATIVE CIRCLED NUMBER FOURTEEN
	[0x24EF, [0x31, 0x35]], // (⓯) NEGATIVE CIRCLED NUMBER FIFTEEN
	[0x24F0, [0x31, 0x36]], // (⓰) NEGATIVE CIRCLED NUMBER SIXTEEN
	[0x24F1, [0x31, 0x37]], // (⓱) NEGATIVE CIRCLED NUMBER SEVENTEEN
	[0x24F2, [0x31, 0x38]], // (⓲) NEGATIVE CIRCLED NUMBER EIGHTEEN
	[0x24F3, [0x31, 0x39]], // (⓳) NEGATIVE CIRCLED NUMBER NINETEEN
	[0x24F4, [0x32, 0x30]], // (⓴) NEGATIVE CIRCLED NUMBER TWENTY
	// double-circled => digits
	[0x24F5, [0x31]], // (⓵) DOUBLE CIRCLED DIGIT ONE
	[0x24F6, [0x32]], // (⓶) DOUBLE CIRCLED DIGIT TWO
	[0x24F7, [0x33]], // (⓷) DOUBLE CIRCLED DIGIT THREE
	[0x24F8, [0x34]], // (⓸) DOUBLE CIRCLED DIGIT FOUR
	[0x24F9, [0x35]], // (⓹) DOUBLE CIRCLED DIGIT FIVE
	[0x24FA, [0x36]], // (⓺) DOUBLE CIRCLED DIGIT SIX
	[0x24FB, [0x37]], // (⓻) DOUBLE CIRCLED DIGIT SEVEN
	[0x24FC, [0x38]], // (⓼) DOUBLE CIRCLED DIGIT EIGHT
	[0x24FD, [0x39]], // (⓽) DOUBLE CIRCLED DIGIT NINE
	[0x24FE, [0x31, 0x30]], // (⓾) DOUBLE CIRCLED NUMBER TEN
	// negative circled => digits
	[0x2776, [0x31]], // (❶) DINGBAT NEGATIVE CIRCLED DIGIT ONE
	[0x2777, [0x32]], // (❷) DINGBAT NEGATIVE CIRCLED DIGIT TWO
	[0x2778, [0x33]], // (❸) DINGBAT NEGATIVE CIRCLED DIGIT THREE
	[0x2779, [0x34]], // (❹) DINGBAT NEGATIVE CIRCLED DIGIT FOUR
	[0x277A, [0x35]], // (❺) DINGBAT NEGATIVE CIRCLED DIGIT FIVE
	[0x277B, [0x36]], // (❻) DINGBAT NEGATIVE CIRCLED DIGIT SIX
	[0x277C, [0x37]], // (❼) DINGBAT NEGATIVE CIRCLED DIGIT SEVEN
	[0x277D, [0x38]], // (❽) DINGBAT NEGATIVE CIRCLED DIGIT EIGHT
	[0x277E, [0x39]], // (❾) DINGBAT NEGATIVE CIRCLED DIGIT NINE
	[0x277F, [0x31, 0x30]], // (❿) DINGBAT NEGATIVE CIRCLED NUMBER TEN
	// circled sans-serif => digits
	[0x1F10B, [0x30]], // (🄋) DINGBAT CIRCLED SANS-SERIF DIGIT ZERO
	[0x2780, [0x31]], // (➀) DINGBAT CIRCLED SANS-SERIF DIGIT ONE
	[0x2781, [0x32]], // (➁) DINGBAT CIRCLED SANS-SERIF DIGIT TWO
	[0x2782, [0x33]], // (➂) DINGBAT CIRCLED SANS-SERIF DIGIT THREE
	[0x2783, [0x34]], // (➃) DINGBAT CIRCLED SANS-SERIF DIGIT FOUR
	[0x2784, [0x35]], // (➄) DINGBAT CIRCLED SANS-SERIF DIGIT FIVE
	[0x2785, [0x36]], // (➅) DINGBAT CIRCLED SANS-SERIF DIGIT SIX
	[0x2786, [0x37]], // (➆) DINGBAT CIRCLED SANS-SERIF DIGIT SEVEN
	[0x2787, [0x38]], // (➇) DINGBAT CIRCLED SANS-SERIF DIGIT EIGHT
	[0x2788, [0x39]], // (➈) DINGBAT CIRCLED SANS-SERIF DIGIT NINE
	[0x2789, [0x31, 0x30]], // (➉) DINGBAT CIRCLED SANS-SERIF NUMBER TEN
	// negative circled sans-serif => digits
	[0x1F10C, [0x30]], // (🄌) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT ZERO
	[0x278A, [0x31]], // (➊) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT ONE
	[0x278B, [0x32]], // (➋) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT TWO
	[0x278C, [0x33]], // (➌) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT THREE
	[0x278D, [0x34]], // (➍) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT FOUR
	[0x278E, [0x35]], // (➎) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT FIVE
	[0x278F, [0x36]], // (➏) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT SIX
	[0x2790, [0x37]], // (➐) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT SEVEN
	[0x2791, [0x38]], // (➑) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT EIGHT
	[0x2792, [0x39]], // (➒) DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT NINE
	[0x2793, [0x31, 0x30]], // (➓) DINGBAT NEGATIVE CIRCLED SANS-SERIF NUMBER TEN
	// negative circled => a-z
	[0x1F150, [0x61]], // (🅐) NEGATIVE CIRCLED LATIN CAPITAL LETTER A
	[0x1F151, [0x62]], // (🅑) NEGATIVE CIRCLED LATIN CAPITAL LETTER B
	[0x1F152, [0x63]], // (🅒) NEGATIVE CIRCLED LATIN CAPITAL LETTER C
	[0x1F153, [0x64]], // (🅓) NEGATIVE CIRCLED LATIN CAPITAL LETTER D
	[0x1F154, [0x65]], // (🅔) NEGATIVE CIRCLED LATIN CAPITAL LETTER E
	[0x1F155, [0x66]], // (🅕) NEGATIVE CIRCLED LATIN CAPITAL LETTER F
	[0x1F156, [0x67]], // (🅖) NEGATIVE CIRCLED LATIN CAPITAL LETTER G
	[0x1F157, [0x68]], // (🅗) NEGATIVE CIRCLED LATIN CAPITAL LETTER H
	[0x1F158, [0x69]], // (🅘) NEGATIVE CIRCLED LATIN CAPITAL LETTER I
	[0x1F159, [0x6A]], // (🅙) NEGATIVE CIRCLED LATIN CAPITAL LETTER J
	[0x1F15A, [0x6B]], // (🅚) NEGATIVE CIRCLED LATIN CAPITAL LETTER K
	[0x1F15B, [0x6C]], // (🅛) NEGATIVE CIRCLED LATIN CAPITAL LETTER L
	[0x1F15C, [0x6D]], // (🅜) NEGATIVE CIRCLED LATIN CAPITAL LETTER M
	[0x1F15D, [0x6E]], // (🅝) NEGATIVE CIRCLED LATIN CAPITAL LETTER N
	[0x1F15E, [0x6F]], // (🅞) NEGATIVE CIRCLED LATIN CAPITAL LETTER O
	[0x1F15F, [0x70]], // (🅟) NEGATIVE CIRCLED LATIN CAPITAL LETTER P
	[0x1F160, [0x71]], // (🅠) NEGATIVE CIRCLED LATIN CAPITAL LETTER Q
	[0x1F161, [0x72]], // (🅡) NEGATIVE CIRCLED LATIN CAPITAL LETTER R
	[0x1F162, [0x73]], // (🅢) NEGATIVE CIRCLED LATIN CAPITAL LETTER S
	[0x1F163, [0x74]], // (🅣) NEGATIVE CIRCLED LATIN CAPITAL LETTER T
	[0x1F164, [0x75]], // (🅤) NEGATIVE CIRCLED LATIN CAPITAL LETTER U
	[0x1F165, [0x76]], // (🅥) NEGATIVE CIRCLED LATIN CAPITAL LETTER V
	[0x1F166, [0x77]], // (🅦) NEGATIVE CIRCLED LATIN CAPITAL LETTER W
	[0x1F167, [0x78]], // (🅧) NEGATIVE CIRCLED LATIN CAPITAL LETTER X
	[0x1F168, [0x79]], // (🅨) NEGATIVE CIRCLED LATIN CAPITAL LETTER Y
	[0x1F169, [0x7A]], // (🅩) NEGATIVE CIRCLED LATIN CAPITAL LETTER Z
	*/

	// negative squared => a-z
	// these contain some emoji
	// 0x1F170, // (🅰) NEGATIVE SQUARED LATIN CAPITAL LETTER A
	// 0x1F171, // (🅱) NEGATIVE SQUARED LATIN CAPITAL LETTER B
	// 0x1F17E, // (🅾) NEGATIVE SQUARED LATIN CAPITAL LETTER O
	// 0x1F17F, // (🅿) NEGATIVE SQUARED LATIN CAPITAL LETTER P

];