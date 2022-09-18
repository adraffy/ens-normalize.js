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

	// initial hyphen-likes
	[0x2011, [0x2D]], // 2011 (‑) NON-BREAKING HYPHEN
	[0x2013, [0x2D]], // 2013 (–) EN DASH
	[0x2014, [0x2D]], // 2014 (—) EM DASH
	[0x2212, [0x2D]], // 2212 (−) MINUS SIGN

	// additional hyphen-likes
	// https://discuss.ens.domains/t/ens-name-normalization/8652/348
	[0x2010, [0x2D]], // 2010 (‐) HYPHEN
	[0x2012, [0x2D]], // 2012 (‒) FIGURE DASH
	[0x2015, [0x2D]], // 2015 (―) HORIZONTAL BAR
	[0x207B, [0x2D]], // 207B (⁻) SUPERSCRIPT MINUS
	[0x208B, [0x2D]], // 208B (₋) SUBSCRIPT MINUS
	[0xFE31, [0x2D]], // FE31 (︱) PRESENTATION FORM FOR VERTICAL EM DASH
	[0xFE32, [0x2D]], // FE32 (︲) PRESENTATION FORM FOR VERTICAL EN DASH
	[0xFE58, [0x2D]], // FE58 (﹘) SMALL EM DASH

	// more hyphen-likes
	// https://discuss.ens.domains/t/ens-name-normalization/8652/393
	[0x23BA, [0x2D]], // 23BA (⎺) HORIZONTAL SCAN LINE-1
	[0x23BB, [0x2D]], // 23BB (⎻) HORIZONTAL SCAN LINE-3
	[0x23BC, [0x2D]], // 23BC (⎼) HORIZONTAL SCAN LINE-7
	[0x23BD, [0x2D]], // 23BD (⎽) HORIZONTAL SCAN LINE-9
	[0x23E4, [0x2D]], // 23E4 (⏤) STRAIGHTNESS
	[0x23AF, [0x2D]], // 23AF (⎯) HORIZONTAL LINE EXTENSION

	// more hyphen-likes
	// https://discuss.ens.domains/t/ens-name-normalization/8652/396
	[0x2043, [0x2D]], // 2043 (⁃) HYPHEN BULLET 
	[0x2027, [0x2D]], // 2027 (‧) HYPHENATION POINT

	// 27 (') APOSTROPHE => 2019 (’) RIGHT SINGLE QUOTATION MARK
	// https://discuss.ens.domains/t/ens-name-normalization/8652/403
	[0x27, [0x2019]],
	
];