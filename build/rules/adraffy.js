import STYLE_DROP from './style-drop.js';
import DEMOJI from './demoji.js';
import EMOJI_ZWJ from './emoji-zwj.js';
import EMOJI_SEQ from './emoji-seq.js';
export default [
	// add all the emoji that had FE0F dropped
	...STYLE_DROP,
	// demote all the emoji that IDNA2003 mapped
	...DEMOJI,

	// nuke the keycaps that IDNA mangled
	// [0-9] 20E3 FE0F => [0-9]
	{ty: 'keycap-drop', src: '30..39'},
	
	// prevent digits from being emoji
	{ty: 'demoji', src: '30..39'},

	// permit solo regional emojis
	{ty: 'style-opt', src: '1F1E6..1F1FF'}, 

	// ************************************************************
	// safe modifications

	// add whitelist zwjs 
	...EMOJI_ZWJ,
	// add reasonable non-RGI zwjs
	{ty: 'emoji-zwj', src: '1F93C 1F3FB 200D 2642'}, // women wrestling 
	{ty: 'emoji-zwj', src: '1F93C 1F3FC 200D 2642'}, // w/ skin colors
	{ty: 'emoji-zwj', src: '1F93C 1F3FD 200D 2642'},
	{ty: 'emoji-zwj', src: '1F93C 1F3FE 200D 2642'},
	{ty: 'emoji-zwj', src: '1F93C 1F3FF 200D 2642'},

	// add whitelist seqs
	...EMOJI_SEQ,
	// prevent arbitrary tag-seqs
	{ty: 'disable-tags'},

	// enable new emoji
	{ty: 'style-req', src: '2049'}, // ?!
	{ty: 'style-req', src: '203C'}, // !!

	// disable IDNA mapped stops
	// https://discuss.ens.domains/t/ens-name-normalization/8652/7
	{ty: 'disallow', src: '3002 FF0E FF61'},

	// allow underscore
	// https://discuss.ens.domains/t/ens-name-normalization/8652/26
	{ty: 'valid', src: '5F'}, // _

	// ************************************************************
	// enable things that IDNA 2008 disabled:

	// should we map this to i?
	// what about (C) (R) vs (M)
	{ty: 'valid', src: '1F6C8'}, // 🛈

	// Negative Circled Letter A-Z
	{ty: 'valid', src: '1F150..1F169'},
	
	// Negative Squared Letter A-Z
	{ty: 'valid', src: '1F170..1F189'},

	// Negative Circled Digit
	{ty: 'map', src: '2776..277F', dst: '278A..2793'}, // map serif to san-serif
	{ty: 'valid', src: '278A..2793'}, //  1-10
	{ty: 'valid', src: '24EB..24F4'}, // 11-20

	// Circled Digits
	{ty: 'valid', src: '24FF'}, // 0
	{ty: 'valid', src: '2780..2789'}, // 1-10 
	{ty: 'map', src: '24F5..24FE', dst: '2780..2789'}, // map double-circle to circle
 	
	// chess icons
	{ty: 'valid', src: '2654..265F'}, 
	// playing card icons
	{ty: 'valid', src: '2660..2667'}, 
	// playing cards
	{ty: 'valid', src: '1F0A0'}, // back???
	{ty: 'valid', src: '1F0A1..1F0AE'}, // spades
	{ty: 'valid', src: '1F0B1..1F0BF'}, // hearts
	{ty: 'valid', src: '1F0C1..1F0CF'}, // diamonds
	{ty: 'valid', src: '1F0D1..1F0DF'}, // clubs
	{ty: 'valid', src: '1F0A0..1F0AE'}, // JCQK
	// mahjong
	{ty: 'valid', src: '1F000..1F02B'},
	// dominos
	{ty: 'valid', src: '1F030..1F093'},

	// planets	
	{ty: 'valid', src: '2641'}, // earth
	{ty: 'valid', src: '2643..2647'}, // plants
	{ty: 'valid', src: '2648..2653'}, // astrology???
	
	// bullets
	{ty: 'valid', src: '2022'}, // circle
	{ty: 'valid', src: '2023'}, // triangle???

	// music stuff 
	{ty: 'valid', src: '2669..266C'}, // notes
	{ty: 'valid', src: '266E'}, // ♮
	{ty: 'map', src: '266D', dst: '0062'}, // ♭
	{ty: 'disallow', src: '266F'}, // ♯
	{ty: 'valid', src: '1F398'}, // 🎘
	{ty: 'valid', src: '1F39C'}, // 🎜
	{ty: 'valid', src: '1F39D'}, // 🎝

	// gender
	{ty: 'valid', src: '2640'}, // ♀
	{ty: 'valid', src: '2642'}, // ♂
	{ty: 'valid', src: '26A2'}, // ⚢️
	{ty: 'valid', src: '26A3'}, // ⚣️
	{ty: 'valid', src: '26A4'}, // ⚤️
	{ty: 'valid', src: '26A5'}, // ⚥️
	{ty: 'valid', src: '26A6'}, // ⚦️
	// 26A7 is an emoji
	{ty: 'valid', src: '26A8'}, // ⚨
	{ty: 'valid', src: '26A9'}, // ⚩️

	{ty: 'valid', src: '1F6C9'}, // 🛉
	{ty: 'valid', src: '1F6CA'}, // 🛊
	
	{ty: 'valid', src: '1F5E2'}, // 🗢
	{ty: 'valid', src: '1F5DF'}, // 🗟
	{ty: 'valid', src: '1F5E0'}, // 🗠
	{ty: 'valid', src: '1F5D8'}, // 🗘
	{ty: 'map', src: '1F5D4', dst: '1F5D6'}, // 🗔
	{ty: 'valid', src: '1F5D6'}, // 🗖
	{ty: 'valid', src: '1F5D7'}, // 🗗
	{ty: 'valid', src: '1F5C5..1F5D0'}, // folder/file icons ???
	{ty: 'valid', src: '1F322'}, // 🌢
	{ty: 'valid', src: '1F323'}, // 🌣
	{ty: 'valid', src: '1F394'}, // 🎔
	{ty: 'valid', src: '1F395'}, // 🎕
	{ty: 'valid', src: '1F3F1'}, // 🏱
	{ty: 'valid', src: '1F3F2'}, // 🏲
	{ty: 'valid', src: '1F3F6'}, // 🏶
	{ty: 'valid', src: '1F4FE'}, // 📾
	{ty: 'valid', src: '1F546'}, // 🕆
	{ty: 'valid', src: '1F547'}, // 🕇
	{ty: 'valid', src: '1F548'}, // 🕈
	{ty: 'valid', src: '1F54F'}, // 🕏
	{ty: 'valid', src: '1F568'}, // 🕨
	{ty: 'valid', src: '1F569'}, // 🕩
	{ty: 'valid', src: '1F56A'}, // 🕪
	{ty: 'valid', src: '1F56B'}, // 🕫
	{ty: 'valid', src: '1F56C'}, // 🕬
	{ty: 'valid', src: '1F56D'}, // 🕭
	{ty: 'valid', src: '1F56E'}, // 🕮
	{ty: 'valid', src: '1F571'}, // 🕱
	{ty: 'valid', src: '1F572'}, // 🕲
	{ty: 'valid', src: '1F57B'}, // 🕻
	{ty: 'valid', src: '1F57C'}, // 🕼
	{ty: 'valid', src: '1F57D'}, // 🕽
	{ty: 'valid', src: '1F57E'}, // 🕾
	{ty: 'valid', src: '1F57F'}, // 🕿
	{ty: 'valid', src: '1F580'}, // 🖀
	{ty: 'valid', src: '1F581'}, // 🖁
	{ty: 'valid', src: '1F582'}, // 🖂
	{ty: 'valid', src: '1F583'}, // 🖃
	{ty: 'valid', src: '1F584'}, // 🖄
	{ty: 'valid', src: '1F585'}, // 🖅
	{ty: 'valid', src: '1F586'}, // 🖆
	{ty: 'valid', src: '1F588'}, // 🖈
	{ty: 'valid', src: '1F589'}, // 🖉
	{ty: 'valid', src: '1F58E'}, // 🖎
	{ty: 'valid', src: '1F58F'}, // 🖏
	{ty: 'valid', src: '1F591'}, // 🖑
	{ty: 'valid', src: '1F592'}, // 🖒
	{ty: 'valid', src: '1F593'}, // 🖓
	{ty: 'valid', src: '1F594'}, // 🖔
	{ty: 'valid', src: '1F597'}, // 🖗
	{ty: 'valid', src: '1F598'}, // 🖘
	{ty: 'valid', src: '1F599'}, // 🖙
	{ty: 'valid', src: '1F59A'}, // 🖚
	{ty: 'valid', src: '1F59B'}, // 🖛
	{ty: 'valid', src: '1F59C'}, // 🖜
	{ty: 'valid', src: '1F59D'}, // 🖝
	{ty: 'valid', src: '1F59E'}, // 🖞
	{ty: 'valid', src: '1F59F'}, // 🖟
	{ty: 'valid', src: '1F5A0'}, // 🖠
	{ty: 'valid', src: '1F5A1'}, // 🖡
	{ty: 'valid', src: '1F5A2'}, // 🖢
	{ty: 'valid', src: '1F5A3'}, // 🖣
	{ty: 'valid', src: '1F5A6'}, // 🖦
	{ty: 'valid', src: '1F5A7'}, // 🖧
	{ty: 'valid', src: '1F5A9'}, // 🖩
	{ty: 'valid', src: '1F5AA'}, // 🖪
	{ty: 'valid', src: '1F5AB'}, // 🖫
	{ty: 'valid', src: '1F5AC'}, // 🖬
	{ty: 'valid', src: '1F5AD'}, // 🖭
	{ty: 'valid', src: '1F5AE'}, // 🖮
	{ty: 'valid', src: '1F5AF'}, // 🖯
	{ty: 'valid', src: '1F5B0'}, // 🖰
	{ty: 'valid', src: '1F5B3'}, // 🖳
	{ty: 'valid', src: '1F5B4'}, // 🖴
	{ty: 'valid', src: '1F5B5'}, // 🖵
	{ty: 'valid', src: '1F5B6'}, // 🖶
	{ty: 'valid', src: '1F5B7'}, // 🖷
	{ty: 'valid', src: '1F5B8'}, // 🖸
	{ty: 'valid', src: '1F5B9'}, // 🖹
	{ty: 'valid', src: '1F5BA'}, // 🖺
	{ty: 'valid', src: '1F5BB'}, // 🖻
	{ty: 'valid', src: '1F5BD'}, // 🖽
	{ty: 'valid', src: '1F5BE'}, // 🖾
	{ty: 'map', src: '1F5DA', dst: '61 61'}, // aA to aa
	{ty: 'map', src: '1F5DB', dst: '61 61'}, // Aa to aa

	// thought bubbles + lightning
	{ty: 'valid', src: '1F5E9..1F5EE 1F5F0..1F5F2'},

	// ballot checkmarks
	{ty: 'valid', src: '1F5F4..1F5F7'}, // x
	{ty: 'valid', src: '1F5F8 1F5F9'}, // check

	// warning/cancel
	{ty: 'valid', src: '1F6C6 1F6C7 1F5D9'},

	{ty: 'valid', src: '1F6E6 1F6E7 1F6E8 1F6EA'}, // planes
	{ty: 'valid', src: '1F6F1'}, // truck
	{ty: 'valid', src: '1F6F2'}, // train

	// 20211227
	
	{ty: 'valid', src: '263B'}, // ☻

	{ty: 'valid', src: '2605'}, // ★
	{ty: 'valid', src: '2606'}, // ☆
	{ty: 'valid', src: '272F'}, // ✯
	{ty: 'valid', src: '272A'}, // ✪

	{ty: 'valid', src: '2388'}, // ⎈
	{ty: 'valid', src: '058D'}, // ֍
	{ty: 'map', src: '058E', dst: '058D'}, // ֎

	{ty: 'valid', src: '27E0'}, // ⟠
	{ty: 'valid', src: '29EB'}, // ⧫
	{ty: 'valid', src: '2630'}, // ☰

	// math
	{ty: 'valid', src: '2206'}, // ∆
	{ty: 'valid', src: '2207'}, // ∇
	{ty: 'valid', src: '2211'}, // ∑
	{ty: 'valid', src: '221E'}, // ∞
	{ty: 'valid', src: '22C8'}, // ⋈

	// currency
	{ty: 'valid', src: '24'}, // $
	{ty: 'valid', src: 'A2'}, // ¢
	{ty: 'valid', src: 'A3'}, // £
	{ty: 'valid', src: 'A5'}, // ¥
	{ty: 'valid', src: '20AC'}, // €
	{ty: 'valid', src: '20BF'}, // ₿


	//'2596..259F', // QUADRANTS
	//'25A0..25EF', // SHAPES
];