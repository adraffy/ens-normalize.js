export default [

	// Disable IDNA Mapped Stops
	{ty: 'disallow', src: '3002 FF0E FF61'},

	// Add regional indicators
	{ty: 'regional', src: '1F1E6..1F1FF'}, 

	// Add tag-spec
	{ty: 'tag-spec', src: 'E0020..E007E'},

	// Add OG keycaps
	{ty: 'keycap', src: '30..39'},

	// Add keycaps lost from 2003 mangling
	{ty: 'styled-keycap', src: '2A'}, // *
	{ty: 'styled-keycap', src: '23'}, // #

	// Add emoji missing from both 2003 and 2008
	{ty: 'styled-emoji', src: '2049'}, // ?!
	{ty: 'styled-emoji', src: '203C'}, // !!

	// Kill the following emoji
	{ty: 'demoji', src: '2122', dst: '74 6D'}, // ™ -> tm
	{ty: 'demoji', src: '2139', dst: '69'}, // ℹ -> i
	{ty: 'demoji', src: '24C2', dst: '6D'}, // Ⓜ -> m
	{ty: 'demoji', src: '3297', dst: '795D'}, // ㊗
	{ty: 'demoji', src: '3299', dst: '79D8'}, // ㊙
	{ty: 'demoji', src: '1F201', dst: '30B3 30B3'}, // 🈁
	{ty: 'demoji', src: '1F202', dst: '30B5'}, // 🈂
	{ty: 'demoji', src: '1F21A', dst: '7121'}, // 🈚
	{ty: 'demoji', src: '1F22F', dst: '6307'}, // 🈯
	{ty: 'demoji', src: '1F232', dst: '7981'}, // 🈲
	{ty: 'demoji', src: '1F233', dst: '7A7A'}, // 🈳
	{ty: 'demoji', src: '1F234', dst: '5408'}, // 🈴
	{ty: 'demoji', src: '1F235', dst: '6E80'}, // 🈵
	{ty: 'demoji', src: '1F236', dst: '6709'}, // 🈶
	{ty: 'demoji', src: '1F237', dst: '6708'}, // 🈷
	{ty: 'demoji', src: '1F238', dst: '7533'}, // 🈸
	{ty: 'demoji', src: '1F239', dst: '5272'}, // 🈹
	{ty: 'demoji', src: '1F23A', dst: '55B6'}, // 🈺
	{ty: 'demoji', src: '1F250', dst: '5F97'}, // 🉐
	{ty: 'demoji', src: '1F251', dst: '53EF'}, // 🉑

	// should we map this to i?
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

	{ty: 'valid', src: '2640'}, // ♀
	{ty: 'valid', src: '2642'}, // ♂
	{ty: 'valid', src: '1F6C9'}, // 🛉
	{ty: 'valid', src: '1F6CA'}, // 🛊
	
	{ty: 'valid', src: '2388'}, // helm
	{ty: 'valid', src: '2605'}, // 5-star???
	{ty: 'valid', src: '221E'}, // infinity

	{ty: 'valid', src: '1F5E2'}, // lips
	{ty: 'valid', src: '1F5DF'}, // newspaper
	{ty: 'valid', src: '1F5E0'}, // chart
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

	/*
	// hummm
	'2596..259F', // QUADRANTS
	'25A0..25EF', // SHAPES

	// rays
	// 1F5E4..1F5E7
	// _
	// 1F5D5

	// 00A2 = ¢
	// 0024 = $
	
	// 263A = ☺
	// 263B = ☻ 
	*/
];