import {explode_cp} from '../utils.js';
import {AUGMENTED_ALL} from '../unicode-logic.js';

const AZ26 = explode_cp('abcdefghijklmnopqrstuvwxyz');

// order here is important
// TODO: move non-restricted scripts into this format
// TODO: move allow/deny into rule files: wholes => {wholes, allow, deny}
export const ORDERED_SCRIPTS = [
	{name: 'Korean', test: ['Hang'], rest: ['Hani', AUGMENTED_ALL], allow: AZ26},
	{name: 'Japanese', test: ['Kana', 'Hira'], rest: ['Hani', AUGMENTED_ALL], allow: AZ26}, //, deny: [0x4E00]}, grr this is also number 1
	{name: 'Han', test: ['Hani'], rest: [AUGMENTED_ALL], allow: AZ26},
	{name: 'Latin', test: ['Latn'], rest: [AUGMENTED_ALL]},
	{name: 'Cyrillic', test: ['Cyrl'], rest: [AUGMENTED_ALL]},
	{name: 'Greek', test: ['Grek'], rest: [AUGMENTED_ALL]}, // rest: [], extra: explode_cp('πξ')},
	{name: 'Arabic', test: ['Arab'], rest: [], allow: explode_cp('-')},
	{name: 'Devanagari', test: ['Deva'], rest: []},
	{name: 'Hebrew', test: ['Hebr'], rest: [], allow: explode_cp('₪')},
	{name: 'Thai', test: ['Thai'], rest: [], allow: explode_cp('฿')},
];

// TODO: give script extensions to restricted (low priority)
export const CHANGED_SCRIPTS = {
	Zyyy: [
		// relax ethereum symbol
		// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/2
		// 0x3BE (ξ) GREEK SMALL LETTER XI
		// 0x39E (Ξ) GREEK CAPITAL LETTER XI (is mapped)
		0x3BE,

		// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/10
		// 0x3C0 (π) GREEK SMALL LETTER PI
		0x3C0,

		// not sure if this should be greek
		// 0x0B5 (µ) MICRO SIGN (mapped)
		// 0x3BC (μ) GREEK SMALL LETTER MU
		//0x3BC, 
		// 0x3C3 (σ) GREEK SMALL LETTER SIGMA
		//0x3C3,
		// 0x3B1 (α) GREEK SMALL LETTER ALPHA
	],
	Hani: [
		0x3013, // (〓) GETA MARK
	],
	Kana: [
		0x30FB, // (・) KATAKANA MIDDLE DOT
		0x30FC, // (ー) KATAKANA-HIRAGANA PROLONGED SOUND MARK (TODO: future, this could be "Jpan")
	],
	Arab: [
		// from script ext
		0x64B, // (◌ً) ARABIC FATHATAN
		0x64C, // (◌ٌ) ARABIC DAMMATAN
		0x64D, // (◌ٍ) ARABIC KASRATAN
		0x64E, // (◌َ) ARABIC FATHA
		0x64F, // (◌ُ) ARABIC DAMMA
		0x650, // (◌ِ) ARABIC KASRA
		0x651, // (◌ّ) ARABIC SHADDA
		0x652, // (◌ْ) ARABIC SUKUN
		0x653, // (◌ٓ) ARABIC MADDAH ABOVE
		0x654, // (◌ٔ) ARABIC HAMZA ABOVE
		0x655, // (◌ٕ) ARABIC HAMZA BELOW
	],
};

export const RESTRICTED_SCRIPTS = [

	// moved to ordered
	//'Arab', // Arabic -- 15000 pure, underscores, only 11 latin mixed (spoofs), and "0x"
	//'Deva', // Devanagari -- 2700 pure but 4
	//'Hebr', // Hebrew -- 1466 pure, 17 spoofs with Latin
	//'Thai', // Thai -- 1000+ pure, spoof mixed
	//'Grek', // Greek -- 200 pures with 80+ spoofs
	
	// 20221018
	'Beng', // Bengali -- all(827) pure
	'Taml', // Tamil -- all(428) pure
	'Tibt', // Tibetan -- pure(175) + mixed are faces

	// disabled
	'Brai', // Braille

	// 20221017
	// to get normalization to V1
	// these can get fixed later
	'Bopo', // Bopomofo -- all spoofs
	'Orya', // Oriya -- no legit non-pure registrations
	'Thaa', // Thaana -- 1 reg, pure
	'Sinh', // Sinhala -- all junk
	'Guru', // Gurmukhi -- all(73) pure but 1 
	'Gujr', // Gujarati -- all(47) pure
	'Telu', // Telugu -- 52, 3 not pure, faces/memes
	'Knda', // Kannada -- few digits + eye balls (50)
	'Mlym', // Malayalam -- all(22) pure
	'Laoo', // Lao -- all pure(56) but 6 
	'Geor', // Georgian -- all(14) pure but 1 
	'Mymr', // Myanmar -- all(22) pure
	'Ethi', // Ethiopic -- all(15) pure
	'Khmr', // Khmer -- all(20) pure
	'Armn', // Armenian -- all(20) pure but 6 (all spoofs)

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
	'Lina', // Linear A
	'Linb', // Linear B
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
	'Sgnw', // SignWriting
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