import {parse_cp_range} from '../utils.js';
import UNPRINTABLES from '../unprintables.js';

// characters that should be escaped for display 
export default [

	// uprintables
	...UNPRINTABLES,

	// whitespace
	//0x20, // ( ) SPACE
	0xA0, // ( ) NO-BREAK SPACE
	0x1680, // ( ) OGHAM SPACE MARK
	0x2000, // ( ) EN QUAD
	0x2001, // ( ) EM QUAD
	0x2002, // ( ) EN SPACE
	0x2003, // ( ) EM SPACE
	0x2004, // ( ) THREE-PER-EM SPACE
	0x2005, // ( ) FOUR-PER-EM SPACE
	0x2006, // ( ) SIX-PER-EM SPACE
	0x2007, // ( ) FIGURE SPACE
	0x2008, // ( ) PUNCTUATION SPACE
	0x2009, // ( ) THIN SPACE
	0x200A, // ( ) HAIR SPACE
	0x202F, // ( ) NARROW NO-BREAK SPACE
	0x205F, // ( ) MEDIUM MATHEMATICAL SPACE
	0x2800, // (⠀) BRAILLE PATTERN BLANK
	0x3000, // (　) IDEOGRAPHIC SPACE
	
	0xAD, // (­) SOFT HYPHEN
	0x34F, // (◌͏) COMBINING GRAPHEME JOINER
	0x61C, // (�) ARABIC LETTER MARK
	0x115F, // (ᅟ) HANGUL CHOSEONG FILLER
	0x1160, // (ᅠ) HANGUL JUNGSEONG FILLER
	0x17B4, // (◌឴) KHMER VOWEL INHERENT AQ
	0x17B5, // (◌឵) KHMER VOWEL INHERENT AA
	0x180B, // (◌᠋) MONGOLIAN FREE VARIATION SELECTOR ONE
	0x180C, // (◌᠌) MONGOLIAN FREE VARIATION SELECTOR TWO
	0x180D, // (◌᠍) MONGOLIAN FREE VARIATION SELECTOR THREE
	0x180E, // (᠎) MONGOLIAN VOWEL SEPARATOR
	0x180F, // (◌᠏) MONGOLIAN FREE VARIATION SELECTOR FOUR
	0x200B, // (​) ZERO WIDTH SPACE
	0x200C, // (‌) ZERO WIDTH NON-JOINER
	0x200D, // (‍) ZERO WIDTH JOINER
	0x200E, // (�) LEFT-TO-RIGHT MARK
	0x200F, // (�) RIGHT-TO-LEFT MARK
	0x202A, // (�) LEFT-TO-RIGHT EMBEDDING
	0x202B, // (�) RIGHT-TO-LEFT EMBEDDING
	0x202C, // (�) POP DIRECTIONAL FORMATTING
	0x202D, // (�) LEFT-TO-RIGHT OVERRIDE
	0x202E, // (�) RIGHT-TO-LEFT OVERRIDE
	0x2060, // (⁠) WORD JOINER
	0x2061, // (⁡) FUNCTION APPLICATION
	0x2062, // (⁢) INVISIBLE TIMES
	0x2063, // (⁣) INVISIBLE SEPARATOR
	0x2064, // (⁤) INVISIBLE PLUS
	0x2065, // (�) undefined
	0x2066, // (�) LEFT-TO-RIGHT ISOLATE
	0x2067, // (�) RIGHT-TO-LEFT ISOLATE
	0x2068, // (�) FIRST STRONG ISOLATE
	0x2069, // (�) POP DIRECTIONAL ISOLATE
	0x206A, // (⁪) INHIBIT SYMMETRIC SWAPPING
	0x206B, // (⁫) ACTIVATE SYMMETRIC SWAPPING
	0x206C, // (⁬) INHIBIT ARABIC FORM SHAPING
	0x206D, // (⁭) ACTIVATE ARABIC FORM SHAPING
	0x206E, // (⁮) NATIONAL DIGIT SHAPES
	0x206F, // (⁯) NOMINAL DIGIT SHAPES
	0x3164, // (ㅤ) HANGUL FILLER
	0xFEFF, // (﻿) ZERO WIDTH NO-BREAK SPACE
	0xFFA0, // (ﾠ) HALFWIDTH HANGUL FILLER
	0xFFF0, // (�) undefined
	0xFFF1, // (�) undefined
	0xFFF2, // (�) undefined
	0xFFF3, // (�) undefined
	0xFFF4, // (�) undefined
	0xFFF5, // (�) undefined
	0xFFF6, // (�) undefined
	0xFFF7, // (�) undefined
	0xFFF8, // (�) undefined
	0x1BCA0, // (𛲠) SHORTHAND FORMAT LETTER OVERLAP
	0x1BCA1, // (𛲡) SHORTHAND FORMAT CONTINUING OVERLAP
	0x1BCA2, // (𛲢) SHORTHAND FORMAT DOWN STEP
	0x1BCA3, // (𛲣) SHORTHAND FORMAT UP STEP
	0x1D173, // (𝅳) MUSICAL SYMBOL BEGIN BEAM
	0x1D174, // (𝅴) MUSICAL SYMBOL END BEAM
	0x1D175, // (𝅵) MUSICAL SYMBOL BEGIN TIE
	0x1D176, // (𝅶) MUSICAL SYMBOL END TIE
	0x1D177, // (𝅷) MUSICAL SYMBOL BEGIN SLUR
	0x1D178, // (𝅸) MUSICAL SYMBOL END SLUR
	0x1D179, // (𝅹) MUSICAL SYMBOL BEGIN PHRASE
	0x1D17A, // (𝅺) MUSICAL SYMBOL END PHRASE

	// tags
	0xE0000, // (�) undefined
	0xE0001, // (󠀁) LANGUAGE TAG
	0xE0002, // (�) undefined
	0xE0003, // (�) undefined
	0xE0004, // (�) undefined
	0xE0005, // (�) undefined
	0xE0006, // (�) undefined
	0xE0007, // (�) undefined
	0xE0008, // (�) undefined
	0xE0009, // (�) undefined
	0xE000A, // (�) undefined
	0xE000B, // (�) undefined
	0xE000C, // (�) undefined
	0xE000D, // (�) undefined
	0xE000E, // (�) undefined
	0xE000F, // (�) undefined
	0xE0010, // (�) undefined
	0xE0011, // (�) undefined
	0xE0012, // (�) undefined
	0xE0013, // (�) undefined
	0xE0014, // (�) undefined
	0xE0015, // (�) undefined
	0xE0016, // (�) undefined
	0xE0017, // (�) undefined
	0xE0018, // (�) undefined
	0xE0019, // (�) undefined
	0xE001A, // (�) undefined
	0xE001B, // (�) undefined
	0xE001C, // (�) undefined
	0xE001D, // (�) undefined
	0xE001E, // (�) undefined
	0xE001F, // (�) undefined
	0xE0020, // (󠀠) TAG SPACE
	0xE0021, // (󠀡) TAG EXCLAMATION MARK
	0xE0022, // (󠀢) TAG QUOTATION MARK
	0xE0023, // (󠀣) TAG NUMBER SIGN
	0xE0024, // (󠀤) TAG DOLLAR SIGN
	0xE0025, // (󠀥) TAG PERCENT SIGN
	0xE0026, // (󠀦) TAG AMPERSAND
	0xE0027, // (󠀧) TAG APOSTROPHE
	0xE0028, // (󠀨) TAG LEFT PARENTHESIS
	0xE0029, // (󠀩) TAG RIGHT PARENTHESIS
	0xE002A, // (󠀪) TAG ASTERISK
	0xE002B, // (󠀫) TAG PLUS SIGN
	0xE002C, // (󠀬) TAG COMMA
	0xE002D, // (󠀭) TAG HYPHEN-MINUS
	0xE002E, // (󠀮) TAG FULL STOP
	0xE002F, // (󠀯) TAG SOLIDUS
	0xE0030, // (󠀰) TAG DIGIT ZERO
	0xE0031, // (󠀱) TAG DIGIT ONE
	0xE0032, // (󠀲) TAG DIGIT TWO
	0xE0033, // (󠀳) TAG DIGIT THREE
	0xE0034, // (󠀴) TAG DIGIT FOUR
	0xE0035, // (󠀵) TAG DIGIT FIVE
	0xE0036, // (󠀶) TAG DIGIT SIX
	0xE0037, // (󠀷) TAG DIGIT SEVEN
	0xE0038, // (󠀸) TAG DIGIT EIGHT
	0xE0039, // (󠀹) TAG DIGIT NINE
	0xE003A, // (󠀺) TAG COLON
	0xE003B, // (󠀻) TAG SEMICOLON
	0xE003C, // (󠀼) TAG LESS-THAN SIGN
	0xE003D, // (󠀽) TAG EQUALS SIGN
	0xE003E, // (󠀾) TAG GREATER-THAN SIGN
	0xE003F, // (󠀿) TAG QUESTION MARK
	0xE0040, // (󠁀) TAG COMMERCIAL AT
	0xE0041, // (󠁁) TAG LATIN CAPITAL LETTER A
	0xE0042, // (󠁂) TAG LATIN CAPITAL LETTER B
	0xE0043, // (󠁃) TAG LATIN CAPITAL LETTER C
	0xE0044, // (󠁄) TAG LATIN CAPITAL LETTER D
	0xE0045, // (󠁅) TAG LATIN CAPITAL LETTER E
	0xE0046, // (󠁆) TAG LATIN CAPITAL LETTER F
	0xE0047, // (󠁇) TAG LATIN CAPITAL LETTER G
	0xE0048, // (󠁈) TAG LATIN CAPITAL LETTER H
	0xE0049, // (󠁉) TAG LATIN CAPITAL LETTER I
	0xE004A, // (󠁊) TAG LATIN CAPITAL LETTER J
	0xE004B, // (󠁋) TAG LATIN CAPITAL LETTER K
	0xE004C, // (󠁌) TAG LATIN CAPITAL LETTER L
	0xE004D, // (󠁍) TAG LATIN CAPITAL LETTER M
	0xE004E, // (󠁎) TAG LATIN CAPITAL LETTER N
	0xE004F, // (󠁏) TAG LATIN CAPITAL LETTER O
	0xE0050, // (󠁐) TAG LATIN CAPITAL LETTER P
	0xE0051, // (󠁑) TAG LATIN CAPITAL LETTER Q
	0xE0052, // (󠁒) TAG LATIN CAPITAL LETTER R
	0xE0053, // (󠁓) TAG LATIN CAPITAL LETTER S
	0xE0054, // (󠁔) TAG LATIN CAPITAL LETTER T
	0xE0055, // (󠁕) TAG LATIN CAPITAL LETTER U
	0xE0056, // (󠁖) TAG LATIN CAPITAL LETTER V
	0xE0057, // (󠁗) TAG LATIN CAPITAL LETTER W
	0xE0058, // (󠁘) TAG LATIN CAPITAL LETTER X
	0xE0059, // (󠁙) TAG LATIN CAPITAL LETTER Y
	0xE005A, // (󠁚) TAG LATIN CAPITAL LETTER Z
	0xE005B, // (󠁛) TAG LEFT SQUARE BRACKET
	0xE005C, // (󠁜) TAG REVERSE SOLIDUS
	0xE005D, // (󠁝) TAG RIGHT SQUARE BRACKET
	0xE005E, // (󠁞) TAG CIRCUMFLEX ACCENT
	0xE005F, // (󠁟) TAG LOW LINE
	0xE0060, // (󠁠) TAG GRAVE ACCENT
	0xE0061, // (󠁡) TAG LATIN SMALL LETTER A
	0xE0062, // (󠁢) TAG LATIN SMALL LETTER B
	0xE0063, // (󠁣) TAG LATIN SMALL LETTER C
	0xE0064, // (󠁤) TAG LATIN SMALL LETTER D
	0xE0065, // (󠁥) TAG LATIN SMALL LETTER E
	0xE0066, // (󠁦) TAG LATIN SMALL LETTER F
	0xE0067, // (󠁧) TAG LATIN SMALL LETTER G
	0xE0068, // (󠁨) TAG LATIN SMALL LETTER H
	0xE0069, // (󠁩) TAG LATIN SMALL LETTER I
	0xE006A, // (󠁪) TAG LATIN SMALL LETTER J
	0xE006B, // (󠁫) TAG LATIN SMALL LETTER K
	0xE006C, // (󠁬) TAG LATIN SMALL LETTER L
	0xE006D, // (󠁭) TAG LATIN SMALL LETTER M
	0xE006E, // (󠁮) TAG LATIN SMALL LETTER N
	0xE006F, // (󠁯) TAG LATIN SMALL LETTER O
	0xE0070, // (󠁰) TAG LATIN SMALL LETTER P
	0xE0071, // (󠁱) TAG LATIN SMALL LETTER Q
	0xE0072, // (󠁲) TAG LATIN SMALL LETTER R
	0xE0073, // (󠁳) TAG LATIN SMALL LETTER S
	0xE0074, // (󠁴) TAG LATIN SMALL LETTER T
	0xE0075, // (󠁵) TAG LATIN SMALL LETTER U
	0xE0076, // (󠁶) TAG LATIN SMALL LETTER V
	0xE0077, // (󠁷) TAG LATIN SMALL LETTER W
	0xE0078, // (󠁸) TAG LATIN SMALL LETTER X
	0xE0079, // (󠁹) TAG LATIN SMALL LETTER Y
	0xE007A, // (󠁺) TAG LATIN SMALL LETTER Z
	0xE007B, // (󠁻) TAG LEFT CURLY BRACKET
	0xE007C, // (󠁼) TAG VERTICAL LINE
	0xE007D, // (󠁽) TAG RIGHT CURLY BRACKET
	0xE007E, // (󠁾) TAG TILDE
	0xE007F, // (󠁿) CANCEL TAG
	0xE0080, // (�) undefined
	0xE0081, // (�) undefined
	0xE0082, // (�) undefined
	0xE0083, // (�) undefined
	0xE0084, // (�) undefined
	0xE0085, // (�) undefined
	0xE0086, // (�) undefined
	0xE0087, // (�) undefined
	0xE0088, // (�) undefined
	0xE0089, // (�) undefined
	0xE008A, // (�) undefined
	0xE008B, // (�) undefined
	0xE008C, // (�) undefined
	0xE008D, // (�) undefined
	0xE008E, // (�) undefined
	0xE008F, // (�) undefined
	0xE0090, // (�) undefined
	0xE0091, // (�) undefined
	0xE0092, // (�) undefined
	0xE0093, // (�) undefined
	0xE0094, // (�) undefined
	0xE0095, // (�) undefined
	0xE0096, // (�) undefined
	0xE0097, // (�) undefined
	0xE0098, // (�) undefined
	0xE0099, // (�) undefined
	0xE009A, // (�) undefined
	0xE009B, // (�) undefined
	0xE009C, // (�) undefined
	0xE009D, // (�) undefined
	0xE009E, // (�) undefined
	0xE009F, // (�) undefined
	0xE00A0, // (�) undefined
	0xE00A1, // (�) undefined
	0xE00A2, // (�) undefined
	0xE00A3, // (�) undefined
	0xE00A4, // (�) undefined
	0xE00A5, // (�) undefined
	0xE00A6, // (�) undefined
	0xE00A7, // (�) undefined
	0xE00A8, // (�) undefined
	0xE00A9, // (�) undefined
	0xE00AA, // (�) undefined
	0xE00AB, // (�) undefined
	0xE00AC, // (�) undefined
	0xE00AD, // (�) undefined
	0xE00AE, // (�) undefined
	0xE00AF, // (�) undefined
	0xE00B0, // (�) undefined
	0xE00B1, // (�) undefined
	0xE00B2, // (�) undefined
	0xE00B3, // (�) undefined
	0xE00B4, // (�) undefined
	0xE00B5, // (�) undefined
	0xE00B6, // (�) undefined
	0xE00B7, // (�) undefined
	0xE00B8, // (�) undefined
	0xE00B9, // (�) undefined
	0xE00BA, // (�) undefined
	0xE00BB, // (�) undefined
	0xE00BC, // (�) undefined
	0xE00BD, // (�) undefined
	0xE00BE, // (�) undefined
	0xE00BF, // (�) undefined
	0xE00C0, // (�) undefined
	0xE00C1, // (�) undefined
	0xE00C2, // (�) undefined
	0xE00C3, // (�) undefined
	0xE00C4, // (�) undefined
	0xE00C5, // (�) undefined
	0xE00C6, // (�) undefined
	0xE00C7, // (�) undefined
	0xE00C8, // (�) undefined
	0xE00C9, // (�) undefined
	0xE00CA, // (�) undefined
	0xE00CB, // (�) undefined
	0xE00CC, // (�) undefined
	0xE00CD, // (�) undefined
	0xE00CE, // (�) undefined
	0xE00CF, // (�) undefined
	0xE00D0, // (�) undefined
	0xE00D1, // (�) undefined
	0xE00D2, // (�) undefined
	0xE00D3, // (�) undefined
	0xE00D4, // (�) undefined
	0xE00D5, // (�) undefined
	0xE00D6, // (�) undefined
	0xE00D7, // (�) undefined
	0xE00D8, // (�) undefined
	0xE00D9, // (�) undefined
	0xE00DA, // (�) undefined
	0xE00DB, // (�) undefined
	0xE00DC, // (�) undefined
	0xE00DD, // (�) undefined
	0xE00DE, // (�) undefined
	0xE00DF, // (�) undefined
	0xE00E0, // (�) undefined
	0xE00E1, // (�) undefined
	0xE00E2, // (�) undefined
	0xE00E3, // (�) undefined
	0xE00E4, // (�) undefined
	0xE00E5, // (�) undefined
	0xE00E6, // (�) undefined
	0xE00E7, // (�) undefined
	0xE00E8, // (�) undefined
	0xE00E9, // (�) undefined
	0xE00EA, // (�) undefined
	0xE00EB, // (�) undefined
	0xE00EC, // (�) undefined
	0xE00ED, // (�) undefined
	0xE00EE, // (�) undefined
	0xE00EF, // (�) undefined
	0xE00F0, // (�) undefined
	0xE00F1, // (�) undefined
	0xE00F2, // (�) undefined
	0xE00F3, // (�) undefined
	0xE00F4, // (�) undefined
	0xE00F5, // (�) undefined
	0xE00F6, // (�) undefined
	0xE00F7, // (�) undefined
	0xE00F8, // (�) undefined
	0xE00F9, // (�) undefined
	0xE00FA, // (�) undefined
	0xE00FB, // (�) undefined
	0xE00FC, // (�) undefined
	0xE00FD, // (�) undefined
	0xE00FE, // (�) undefined
	0xE00FF, // (�) undefined

	// variation selectors
	0xFE00, // (◌︀) VARIATION SELECTOR-1
	0xFE01, // (◌︁) VARIATION SELECTOR-2
	0xFE02, // (◌︂) VARIATION SELECTOR-3
	0xFE03, // (◌︃) VARIATION SELECTOR-4
	0xFE04, // (◌︄) VARIATION SELECTOR-5
	0xFE05, // (◌︅) VARIATION SELECTOR-6
	0xFE06, // (◌︆) VARIATION SELECTOR-7
	0xFE07, // (◌︇) VARIATION SELECTOR-8
	0xFE08, // (◌︈) VARIATION SELECTOR-9
	0xFE09, // (◌︉) VARIATION SELECTOR-10
	0xFE0A, // (◌︊) VARIATION SELECTOR-11
	0xFE0B, // (◌︋) VARIATION SELECTOR-12
	0xFE0C, // (◌︌) VARIATION SELECTOR-13
	0xFE0D, // (◌︍) VARIATION SELECTOR-14
	0xFE0E, // (◌︎) VARIATION SELECTOR-15
	0xFE0F, // (◌️) VARIATION SELECTOR-16
	0xE0100, // (◌󠄀) VARIATION SELECTOR-17
	0xE0101, // (◌󠄁) VARIATION SELECTOR-18
	0xE0102, // (◌󠄂) VARIATION SELECTOR-19
	0xE0103, // (◌󠄃) VARIATION SELECTOR-20
	0xE0104, // (◌󠄄) VARIATION SELECTOR-21
	0xE0105, // (◌󠄅) VARIATION SELECTOR-22
	0xE0106, // (◌󠄆) VARIATION SELECTOR-23
	0xE0107, // (◌󠄇) VARIATION SELECTOR-24
	0xE0108, // (◌󠄈) VARIATION SELECTOR-25
	0xE0109, // (◌󠄉) VARIATION SELECTOR-26
	0xE010A, // (◌󠄊) VARIATION SELECTOR-27
	0xE010B, // (◌󠄋) VARIATION SELECTOR-28
	0xE010C, // (◌󠄌) VARIATION SELECTOR-29
	0xE010D, // (◌󠄍) VARIATION SELECTOR-30
	0xE010E, // (◌󠄎) VARIATION SELECTOR-31
	0xE010F, // (◌󠄏) VARIATION SELECTOR-32
	0xE0110, // (◌󠄐) VARIATION SELECTOR-33
	0xE0111, // (◌󠄑) VARIATION SELECTOR-34
	0xE0112, // (◌󠄒) VARIATION SELECTOR-35
	0xE0113, // (◌󠄓) VARIATION SELECTOR-36
	0xE0114, // (◌󠄔) VARIATION SELECTOR-37
	0xE0115, // (◌󠄕) VARIATION SELECTOR-38
	0xE0116, // (◌󠄖) VARIATION SELECTOR-39
	0xE0117, // (◌󠄗) VARIATION SELECTOR-40
	0xE0118, // (◌󠄘) VARIATION SELECTOR-41
	0xE0119, // (◌󠄙) VARIATION SELECTOR-42
	0xE011A, // (◌󠄚) VARIATION SELECTOR-43
	0xE011B, // (◌󠄛) VARIATION SELECTOR-44
	0xE011C, // (◌󠄜) VARIATION SELECTOR-45
	0xE011D, // (◌󠄝) VARIATION SELECTOR-46
	0xE011E, // (◌󠄞) VARIATION SELECTOR-47
	0xE011F, // (◌󠄟) VARIATION SELECTOR-48
	0xE0120, // (◌󠄠) VARIATION SELECTOR-49
	0xE0121, // (◌󠄡) VARIATION SELECTOR-50
	0xE0122, // (◌󠄢) VARIATION SELECTOR-51
	0xE0123, // (◌󠄣) VARIATION SELECTOR-52
	0xE0124, // (◌󠄤) VARIATION SELECTOR-53
	0xE0125, // (◌󠄥) VARIATION SELECTOR-54
	0xE0126, // (◌󠄦) VARIATION SELECTOR-55
	0xE0127, // (◌󠄧) VARIATION SELECTOR-56
	0xE0128, // (◌󠄨) VARIATION SELECTOR-57
	0xE0129, // (◌󠄩) VARIATION SELECTOR-58
	0xE012A, // (◌󠄪) VARIATION SELECTOR-59
	0xE012B, // (◌󠄫) VARIATION SELECTOR-60
	0xE012C, // (◌󠄬) VARIATION SELECTOR-61
	0xE012D, // (◌󠄭) VARIATION SELECTOR-62
	0xE012E, // (◌󠄮) VARIATION SELECTOR-63
	0xE012F, // (◌󠄯) VARIATION SELECTOR-64
	0xE0130, // (◌󠄰) VARIATION SELECTOR-65
	0xE0131, // (◌󠄱) VARIATION SELECTOR-66
	0xE0132, // (◌󠄲) VARIATION SELECTOR-67
	0xE0133, // (◌󠄳) VARIATION SELECTOR-68
	0xE0134, // (◌󠄴) VARIATION SELECTOR-69
	0xE0135, // (◌󠄵) VARIATION SELECTOR-70
	0xE0136, // (◌󠄶) VARIATION SELECTOR-71
	0xE0137, // (◌󠄷) VARIATION SELECTOR-72
	0xE0138, // (◌󠄸) VARIATION SELECTOR-73
	0xE0139, // (◌󠄹) VARIATION SELECTOR-74
	0xE013A, // (◌󠄺) VARIATION SELECTOR-75
	0xE013B, // (◌󠄻) VARIATION SELECTOR-76
	0xE013C, // (◌󠄼) VARIATION SELECTOR-77
	0xE013D, // (◌󠄽) VARIATION SELECTOR-78
	0xE013E, // (◌󠄾) VARIATION SELECTOR-79
	0xE013F, // (◌󠄿) VARIATION SELECTOR-80
	0xE0140, // (◌󠅀) VARIATION SELECTOR-81
	0xE0141, // (◌󠅁) VARIATION SELECTOR-82
	0xE0142, // (◌󠅂) VARIATION SELECTOR-83
	0xE0143, // (◌󠅃) VARIATION SELECTOR-84
	0xE0144, // (◌󠅄) VARIATION SELECTOR-85
	0xE0145, // (◌󠅅) VARIATION SELECTOR-86
	0xE0146, // (◌󠅆) VARIATION SELECTOR-87
	0xE0147, // (◌󠅇) VARIATION SELECTOR-88
	0xE0148, // (◌󠅈) VARIATION SELECTOR-89
	0xE0149, // (◌󠅉) VARIATION SELECTOR-90
	0xE014A, // (◌󠅊) VARIATION SELECTOR-91
	0xE014B, // (◌󠅋) VARIATION SELECTOR-92
	0xE014C, // (◌󠅌) VARIATION SELECTOR-93
	0xE014D, // (◌󠅍) VARIATION SELECTOR-94
	0xE014E, // (◌󠅎) VARIATION SELECTOR-95
	0xE014F, // (◌󠅏) VARIATION SELECTOR-96
	0xE0150, // (◌󠅐) VARIATION SELECTOR-97
	0xE0151, // (◌󠅑) VARIATION SELECTOR-98
	0xE0152, // (◌󠅒) VARIATION SELECTOR-99
	0xE0153, // (◌󠅓) VARIATION SELECTOR-100
	0xE0154, // (◌󠅔) VARIATION SELECTOR-101
	0xE0155, // (◌󠅕) VARIATION SELECTOR-102
	0xE0156, // (◌󠅖) VARIATION SELECTOR-103
	0xE0157, // (◌󠅗) VARIATION SELECTOR-104
	0xE0158, // (◌󠅘) VARIATION SELECTOR-105
	0xE0159, // (◌󠅙) VARIATION SELECTOR-106
	0xE015A, // (◌󠅚) VARIATION SELECTOR-107
	0xE015B, // (◌󠅛) VARIATION SELECTOR-108
	0xE015C, // (◌󠅜) VARIATION SELECTOR-109
	0xE015D, // (◌󠅝) VARIATION SELECTOR-110
	0xE015E, // (◌󠅞) VARIATION SELECTOR-111
	0xE015F, // (◌󠅟) VARIATION SELECTOR-112
	0xE0160, // (◌󠅠) VARIATION SELECTOR-113
	0xE0161, // (◌󠅡) VARIATION SELECTOR-114
	0xE0162, // (◌󠅢) VARIATION SELECTOR-115
	0xE0163, // (◌󠅣) VARIATION SELECTOR-116
	0xE0164, // (◌󠅤) VARIATION SELECTOR-117
	0xE0165, // (◌󠅥) VARIATION SELECTOR-118
	0xE0166, // (◌󠅦) VARIATION SELECTOR-119
	0xE0167, // (◌󠅧) VARIATION SELECTOR-120
	0xE0168, // (◌󠅨) VARIATION SELECTOR-121
	0xE0169, // (◌󠅩) VARIATION SELECTOR-122
	0xE016A, // (◌󠅪) VARIATION SELECTOR-123
	0xE016B, // (◌󠅫) VARIATION SELECTOR-124
	0xE016C, // (◌󠅬) VARIATION SELECTOR-125
	0xE016D, // (◌󠅭) VARIATION SELECTOR-126
	0xE016E, // (◌󠅮) VARIATION SELECTOR-127
	0xE016F, // (◌󠅯) VARIATION SELECTOR-128
	0xE0170, // (◌󠅰) VARIATION SELECTOR-129
	0xE0171, // (◌󠅱) VARIATION SELECTOR-130
	0xE0172, // (◌󠅲) VARIATION SELECTOR-131
	0xE0173, // (◌󠅳) VARIATION SELECTOR-132
	0xE0174, // (◌󠅴) VARIATION SELECTOR-133
	0xE0175, // (◌󠅵) VARIATION SELECTOR-134
	0xE0176, // (◌󠅶) VARIATION SELECTOR-135
	0xE0177, // (◌󠅷) VARIATION SELECTOR-136
	0xE0178, // (◌󠅸) VARIATION SELECTOR-137
	0xE0179, // (◌󠅹) VARIATION SELECTOR-138
	0xE017A, // (◌󠅺) VARIATION SELECTOR-139
	0xE017B, // (◌󠅻) VARIATION SELECTOR-140
	0xE017C, // (◌󠅼) VARIATION SELECTOR-141
	0xE017D, // (◌󠅽) VARIATION SELECTOR-142
	0xE017E, // (◌󠅾) VARIATION SELECTOR-143
	0xE017F, // (◌󠅿) VARIATION SELECTOR-144
	0xE0180, // (◌󠆀) VARIATION SELECTOR-145
	0xE0181, // (◌󠆁) VARIATION SELECTOR-146
	0xE0182, // (◌󠆂) VARIATION SELECTOR-147
	0xE0183, // (◌󠆃) VARIATION SELECTOR-148
	0xE0184, // (◌󠆄) VARIATION SELECTOR-149
	0xE0185, // (◌󠆅) VARIATION SELECTOR-150
	0xE0186, // (◌󠆆) VARIATION SELECTOR-151
	0xE0187, // (◌󠆇) VARIATION SELECTOR-152
	0xE0188, // (◌󠆈) VARIATION SELECTOR-153
	0xE0189, // (◌󠆉) VARIATION SELECTOR-154
	0xE018A, // (◌󠆊) VARIATION SELECTOR-155
	0xE018B, // (◌󠆋) VARIATION SELECTOR-156
	0xE018C, // (◌󠆌) VARIATION SELECTOR-157
	0xE018D, // (◌󠆍) VARIATION SELECTOR-158
	0xE018E, // (◌󠆎) VARIATION SELECTOR-159
	0xE018F, // (◌󠆏) VARIATION SELECTOR-160
	0xE0190, // (◌󠆐) VARIATION SELECTOR-161
	0xE0191, // (◌󠆑) VARIATION SELECTOR-162
	0xE0192, // (◌󠆒) VARIATION SELECTOR-163
	0xE0193, // (◌󠆓) VARIATION SELECTOR-164
	0xE0194, // (◌󠆔) VARIATION SELECTOR-165
	0xE0195, // (◌󠆕) VARIATION SELECTOR-166
	0xE0196, // (◌󠆖) VARIATION SELECTOR-167
	0xE0197, // (◌󠆗) VARIATION SELECTOR-168
	0xE0198, // (◌󠆘) VARIATION SELECTOR-169
	0xE0199, // (◌󠆙) VARIATION SELECTOR-170
	0xE019A, // (◌󠆚) VARIATION SELECTOR-171
	0xE019B, // (◌󠆛) VARIATION SELECTOR-172
	0xE019C, // (◌󠆜) VARIATION SELECTOR-173
	0xE019D, // (◌󠆝) VARIATION SELECTOR-174
	0xE019E, // (◌󠆞) VARIATION SELECTOR-175
	0xE019F, // (◌󠆟) VARIATION SELECTOR-176
	0xE01A0, // (◌󠆠) VARIATION SELECTOR-177
	0xE01A1, // (◌󠆡) VARIATION SELECTOR-178
	0xE01A2, // (◌󠆢) VARIATION SELECTOR-179
	0xE01A3, // (◌󠆣) VARIATION SELECTOR-180
	0xE01A4, // (◌󠆤) VARIATION SELECTOR-181
	0xE01A5, // (◌󠆥) VARIATION SELECTOR-182
	0xE01A6, // (◌󠆦) VARIATION SELECTOR-183
	0xE01A7, // (◌󠆧) VARIATION SELECTOR-184
	0xE01A8, // (◌󠆨) VARIATION SELECTOR-185
	0xE01A9, // (◌󠆩) VARIATION SELECTOR-186
	0xE01AA, // (◌󠆪) VARIATION SELECTOR-187
	0xE01AB, // (◌󠆫) VARIATION SELECTOR-188
	0xE01AC, // (◌󠆬) VARIATION SELECTOR-189
	0xE01AD, // (◌󠆭) VARIATION SELECTOR-190
	0xE01AE, // (◌󠆮) VARIATION SELECTOR-191
	0xE01AF, // (◌󠆯) VARIATION SELECTOR-192
	0xE01B0, // (◌󠆰) VARIATION SELECTOR-193
	0xE01B1, // (◌󠆱) VARIATION SELECTOR-194
	0xE01B2, // (◌󠆲) VARIATION SELECTOR-195
	0xE01B3, // (◌󠆳) VARIATION SELECTOR-196
	0xE01B4, // (◌󠆴) VARIATION SELECTOR-197
	0xE01B5, // (◌󠆵) VARIATION SELECTOR-198
	0xE01B6, // (◌󠆶) VARIATION SELECTOR-199
	0xE01B7, // (◌󠆷) VARIATION SELECTOR-200
	0xE01B8, // (◌󠆸) VARIATION SELECTOR-201
	0xE01B9, // (◌󠆹) VARIATION SELECTOR-202
	0xE01BA, // (◌󠆺) VARIATION SELECTOR-203
	0xE01BB, // (◌󠆻) VARIATION SELECTOR-204
	0xE01BC, // (◌󠆼) VARIATION SELECTOR-205
	0xE01BD, // (◌󠆽) VARIATION SELECTOR-206
	0xE01BE, // (◌󠆾) VARIATION SELECTOR-207
	0xE01BF, // (◌󠆿) VARIATION SELECTOR-208
	0xE01C0, // (◌󠇀) VARIATION SELECTOR-209
	0xE01C1, // (◌󠇁) VARIATION SELECTOR-210
	0xE01C2, // (◌󠇂) VARIATION SELECTOR-211
	0xE01C3, // (◌󠇃) VARIATION SELECTOR-212
	0xE01C4, // (◌󠇄) VARIATION SELECTOR-213
	0xE01C5, // (◌󠇅) VARIATION SELECTOR-214
	0xE01C6, // (◌󠇆) VARIATION SELECTOR-215
	0xE01C7, // (◌󠇇) VARIATION SELECTOR-216
	0xE01C8, // (◌󠇈) VARIATION SELECTOR-217
	0xE01C9, // (◌󠇉) VARIATION SELECTOR-218
	0xE01CA, // (◌󠇊) VARIATION SELECTOR-219
	0xE01CB, // (◌󠇋) VARIATION SELECTOR-220
	0xE01CC, // (◌󠇌) VARIATION SELECTOR-221
	0xE01CD, // (◌󠇍) VARIATION SELECTOR-222
	0xE01CE, // (◌󠇎) VARIATION SELECTOR-223
	0xE01CF, // (◌󠇏) VARIATION SELECTOR-224
	0xE01D0, // (◌󠇐) VARIATION SELECTOR-225
	0xE01D1, // (◌󠇑) VARIATION SELECTOR-226
	0xE01D2, // (◌󠇒) VARIATION SELECTOR-227
	0xE01D3, // (◌󠇓) VARIATION SELECTOR-228
	0xE01D4, // (◌󠇔) VARIATION SELECTOR-229
	0xE01D5, // (◌󠇕) VARIATION SELECTOR-230
	0xE01D6, // (◌󠇖) VARIATION SELECTOR-231
	0xE01D7, // (◌󠇗) VARIATION SELECTOR-232
	0xE01D8, // (◌󠇘) VARIATION SELECTOR-233
	0xE01D9, // (◌󠇙) VARIATION SELECTOR-234
	0xE01DA, // (◌󠇚) VARIATION SELECTOR-235
	0xE01DB, // (◌󠇛) VARIATION SELECTOR-236
	0xE01DC, // (◌󠇜) VARIATION SELECTOR-237
	0xE01DD, // (◌󠇝) VARIATION SELECTOR-238
	0xE01DE, // (◌󠇞) VARIATION SELECTOR-239
	0xE01DF, // (◌󠇟) VARIATION SELECTOR-240
	0xE01E0, // (◌󠇠) VARIATION SELECTOR-241
	0xE01E1, // (◌󠇡) VARIATION SELECTOR-242
	0xE01E2, // (◌󠇢) VARIATION SELECTOR-243
	0xE01E3, // (◌󠇣) VARIATION SELECTOR-244
	0xE01E4, // (◌󠇤) VARIATION SELECTOR-245
	0xE01E5, // (◌󠇥) VARIATION SELECTOR-246
	0xE01E6, // (◌󠇦) VARIATION SELECTOR-247
	0xE01E7, // (◌󠇧) VARIATION SELECTOR-248
	0xE01E8, // (◌󠇨) VARIATION SELECTOR-249
	0xE01E9, // (◌󠇩) VARIATION SELECTOR-250
	0xE01EA, // (◌󠇪) VARIATION SELECTOR-251
	0xE01EB, // (◌󠇫) VARIATION SELECTOR-252
	0xE01EC, // (◌󠇬) VARIATION SELECTOR-253
	0xE01ED, // (◌󠇭) VARIATION SELECTOR-254
	0xE01EE, // (◌󠇮) VARIATION SELECTOR-255
	0xE01EF, // (◌󠇯) VARIATION SELECTOR-256

	// reserved [3600]
	...parse_cp_range('E01F0..E0FFF'),

];