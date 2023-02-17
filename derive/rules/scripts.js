const $AZ = 'abcdefghijklmnopqrstuvwxyz'; // a-z for romanization

// note: order doesn't matter
// gets re-ordered by rules/group-order.js (source of frequency snapshot)
// which is derived from /validate/dump-group-order.js

// https://www.unicode.org/reports/tr39/#Optional_Detection
// b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
export const NSM_MAX = 4;

export const SCRIPT_GROUPS = [

	// CJK
	{name: 'Japanese', test: ['Kana', 'Hira'], rest: ['Hani', 'Zyyy'], extra: [$AZ], cm: true},
	{name: 'Korean', test: ['Hang'], rest: ['Hani', 'Zyyy'], extra: [$AZ], cm: true},
	{name: 'Han', test: ['Hani'], rest: ['Zyyy'], extra: [$AZ], cm: true},
	{name: 'Bopomofo', test: ['Bopo'], rest: ['Hani'], cm: true},

	// Latin-like
	{name: 'Latin', test: ['Latn', 'Zyyy'], rest: ['Zinh'], cm: true, extra: [
		0x3C0, // (π) GREEK SMALL LETTER PI

		// 20221210: after looking at illegal mixtures,
		// i think this is bad idea, it will just get abused, eg. mμsk
		//0x3BC, // (μ) GREEK SMALL LETTER MU (since Latin mu is mapped)
	]}, 
	{name: 'Cyrillic', test: ['Cyrl'], rest: ['Zyyy', 'Zinh'], cm: true},
	{name: 'Greek', test: ['Grek'], rest: ['Zyyy', 'Zinh'], cm: true},
	
	// 20221215: there is no need for "common" group 
	// it is a proper subset of any of the groups above
	// selecting this group (when multiple groups match)
	// inclusion would only improve the displayed name
	// in the case of pure-common non-emoji
	// eg. "123" is Latin/ASCII instead of Common
	//{name: 'Common', test: ['Zyyy'], cm: 0},
	// this change also requires moving Latin's Zyyy from rest to test

	// 20230213: consider bumping all CM to max of 3
	// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/66
	// https://www.unicode.org/reports/tr39/#Optional_Detection
	// CM by type (see: /derive/dump-cm.js)
	//  1985 Mn Nonspacing_Mark
	//   452 Mc Spacing_Mark
	//    13 Me Enclosing_Mark
	// a. Forbid sequences of the same nonspacing mark.
	// b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
	// c. Forbid sequences of base character + nonspacing mark that look the same as or confusingly similar
	//    => somewhat handled by CM restrictions
	//    => somewhat handled by confusables
	//    => handled by whitelist for Latin-like/CJK

	// was cm: 2
	{name: 'Arabic', test: ['Arab'], extra: ['-']}, // 15000 pure, underscores, only 11 latin mixed (spoofs), and "0x"
	{name: 'Devanagari', test: ['Deva']},           // 2700 pure but 4
	{name: 'Hebrew', test: ['Hebr'], extra: ['₪']}, // 1466 pure, 17 spoofs with Latin
	{name: 'Thai', test: ['Thai'],  extra: ['฿']},  // 1000+ pure, spoof mixed
	{name: 'Bengali', test: ['Beng']},              // pure(827)
	{name: 'Thaana', test: ['Thaa']},               // pure(1)
	{name: 'Gurmukhi', test: ['Guru']},             // pure(73) not(1)

	// was cm: 1
	{name: 'Tamil', test: ['Taml']},     // pure(428)
	{name: 'Tibetan', test: ['Tibt']},   // pure(175) + mixed are faces	
	{name: 'Oriya', test: ['Orya']},     // no legit non-pure registrations
	{name: 'Sinhala', test: ['Sinh']},   // all junk
	{name: 'Gujarati', test: ['Gujr']},  // pure(47) 
	{name: 'Telugu', test: ['Telu']},    // pure(52) not(3), faces/memes
	{name: 'Kannada', test: ['Knda']},   // few digits + eye balls (50)
	{name: 'Malayalam', test: ['Mlym']}, // pure(22) 
	{name: 'Lao', test: ['Laoo']},       // pure(56) not(6) 
	{name: 'Georgian', test: ['Geor']},  // pure(14) not(1)
	{name: 'Myanmar', test: ['Mymr']},   // pure(22) 
	{name: 'Ethiopic', test: ['Ethi']},  // pure(15) 
	{name: 'Khmer', test: ['Khmr']},     // pure(20) 
	{name: 'Armenian', test: ['Armn']},  // pure(20) spoof(6)
];

export const SCRIPT_EXTENSIONS = [
	// relax ethereum symbol
	// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/2
	// 0x39E (Ξ) GREEK CAPITAL LETTER XI => 0x3BE (ξ) GREEK SMALL LETTER XI
	[0x3BE, ['Zyyy']],
];

export const DISALLOWED_SCRIPTS = [
	// https://discuss.ens.domains/t/ens-name-normalization/8652/88
	// https://discuss.ens.domains/t/ens-name-normalization/8652/203
	// https://discuss.ens.domains/t/ens-name-normalization/8652/418 
	// (we can fix this later, requires massive whole-script confusables on .:'s)
	//{name: 'Braille', test: ['Brai]}, // pure(540), 70 ascii/spacer-spoofs
	'Brai', // Braille
	// https://en.wikipedia.org/wiki/Linear_A
	// 20221031: disabled
	'Lina', // Linear A 
	// https://en.wikipedia.org/wiki/Linear_B
	// 20221031: disabled
	'Linb', // Linear B 
	// 202209XX: disabled
	'Sgnw', // SignWriting
];

export const RESTRICTED_SCRIPTS = [

	// https://www.unicode.org/reports/tr31/#Table_Limited_Use_Scripts
	'Adlm', // Adlam -- 0 registrations
	'Bali', // Balinese
	'Bamu', // Bamum
	'Batk', // Batak
	'Cakm', // Chakma
	'Cans', // Canadian Aboriginal
	'Cham', // Cham
	'Cher', // Cherokee
	'Hmnp', // Nyiakeng Puachue Hmong
	'Java', // Javanese
	'Kali', // Kayah Li
	'Lana', // Tai Tham
	'Lepc', // Lepcha
	'Limb', // Limbu
	'Lisu', // Lisu
	'Mand', // Mandaic
	'Mtei', // Meetei Mayek
	'Newa', // Newa
	'Nkoo', // Nko
	'Olck', // Ol Chiki
	'Osge', // Osage
	'Plrd', // Miao
	'Rohg', // Hanifi Rohingya
	'Saur', // Saurashtra
	'Sund', // Sundanese
	'Sylo', // Syloti Nagri
	'Syrc', // Syriac
	'Tale', // Tai Le
	'Talu', // New Tai Lue
	'Tavt', // Tai Viet
	'Tfng', // Tifinagh
	'Vaii', // Vai
	'Wcho', // Wancho
	'Yiii', // Yi

	// https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers
	'Aghb', // Caucasian Albanian
	'Ahom', // Ahom
	'Armi', // Imperial Aramaic
	'Avst', // Avestan
	'Bass', // Bassa Vah
	'Bhks', // Bhaiksuki
	'Brah', // Brahmi
	'Bugi', // Buginese
	'Buhd', // Buhid
	'Cari', // Carian
	'Chrs', // Chorasmian
	'Copt', // Coptic
	'Cpmn', // Cypro Minoan
	'Cprt', // Cypriot
	'Diak', // Dives Akuru
	'Dogr', // Dogra
	'Dsrt', // Deseret
	'Dupl', // Duployan
	'Egyp', // Egyptian Hieroglyphs
	'Elba', // Elbasan
	'Elym', // Elymaic
	'Glag', // Glagolitic
	'Gong', // Gunjala Gondi
	'Gonm', // Masaram Gondi
	'Goth', // Gothic
	'Gran', // Grantha
	'Hano', // Hanunoo
	'Hatr', // Hatran
	'Hluw', // Anatolian Hieroglyphs
	'Hmng', // Pahawh Hmong
	'Hung', // Old Hungarian
	'Ital', // Old Italic
	'Kawi', // Kawi
	'Khar', // Kharoshthi
	'Khoj', // Khojki
	'Kits', // Khitan Small Script
	'Kthi', // Kaithi
	//'Lina', // Linear A
	//'Linb', // Linear B 
	'Lyci', // Lycian
	'Lydi', // Lydian
	'Maka', // Makasar
	'Mahj', // Mahajani
	'Mani', // Manichaean
	'Marc', // Marchen
	'Medf', // Medefaidrin
	'Mend', // Mende Kikakui
	'Merc', // Meroitic Cursive
	'Mero', // Meroitic Hieroglyphs
	'Modi', // Modi
	'Mong', // Mongolian
	'Mroo', // Mro
	'Mult', // Multani
	'Nagm', // Nag Mundari
	'Narb', // Old North Arabian
	'Nand', // Nandinagari
	'Nbat', // Nabataean
	'Nshu', // Nushu
	'Ogam', // Ogham
	'Orkh', // Old Turkic
	'Osma', // Osmanya
	'Ougr', // Old Uyghur
	'Palm', // Palmyrene
	'Pauc', // Pau Cin Hau
	'Perm', // Old Permic
	'Phag', // Phags Pa
	'Phli', // Inscriptional Pahlavi
	'Phlp', // Psalter Pahlavi
	'Phnx', // Phoenician
	'Prti', // Inscriptional Parthian
	'Rjng', // Rejang
	'Runr', // Runic
	'Samr', // Samaritan
	'Sarb', // Old South Arabian
	//'Sgnw', // SignWriting
	'Shaw', // Shavian
	'Shrd', // Sharada
	'Sidd', // Siddham
	'Sind', // Khudawadi
	'Sora', // Sora Sompeng
	'Sogd', // Sogdian
	'Sogo', // Old Sogdian
	'Soyo', // Soyombo
	'Tagb', // Tagbanwa
	'Takr', // Takri
	'Tang', // Tangut
	'Tglg', // Tagalog
	'Tirh', // Tirhuta
	'Tnsa', // Tangsa
	'Toto', // Toto
	'Ugar', // Ugaritic
	'Vith', // Vithkuqi
	'Wara', // Warang Citi
	'Xpeo', // Old Persian
	'Xsux', // Cuneiform
	'Yezi', // Yezidi
	'Zanb', // Zanabazar Square

];