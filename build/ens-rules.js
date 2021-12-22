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

	// Negative Circled Letter A-Z
	{ty: 'emoji', src: '1F150..1F169'},
	
	// Negative Squared Letter A-Z
	{ty: 'emoji', src: '1F170..1F189'},

	// Negative Circled Digit
	{ty: 'map', src: '2776..277F', dst: '278A..2793'}, // map serif to san-serif
	{ty: 'emoji', src: '278A..2793'}, //  1-10
	{ty: 'emoji', src: '24EB..24F4'}, // 11-20

    // Circled Digits
	{ty: 'emoji', src: '24FF'}, // 0
	{ty: 'emoji', src: '2780..2789'}, // 1-10 
	{ty: 'map', src: '24F5..24FE', dst: '2780..2789'}, // map double-circle to circle
 	
	// chess icons
	{ty: 'emoji', src: '2654..265F'}, 
	// playing card icons
	{ty: 'emoji', src: '2660..2667'}, 
	// playing cards
	{ty: 'emoji', src: '1F0A0'}, // back???
	{ty: 'emoji', src: '1F0A1..1F0AE'}, // spades
	{ty: 'emoji', src: '1F0B1..1F0BF'}, // hearts
	{ty: 'emoji', src: '1F0C1..1F0CF'}, // diamonds
	{ty: 'emoji', src: '1F0D1..1F0DF'}, // clubs
	{ty: 'emoji', src: '1F0A0..1F0AE'}, // JCQK
	// mahjong
	{ty: 'emoji', src: '1F000..1F02B'},
	// dominos
	{ty: 'emoji', src: '1F030..1F093'},

    // planets	
	{ty: 'emoji', src: '2641'}, // earth
	{ty: 'emoji', src: '2643..2647'}, // plants
	{ty: 'emoji', src: '2648..2653'}, // astrology???
	
	// gender symbols
	{ty: 'emoji', src: '2640'},
	{ty: 'emoji', src: '2642'}, 

	// misc
	{ty: 'emoji', src: '2388'}, // helm
	{ty: 'emoji', src: '2605'}, // 5-star???
	{ty: 'emoji', src: '221E'}, // infinity

    // bullets
	{ty: 'emoji', src: '2022'}, // circle
	{ty: 'emoji', src: '2023'}, // triangle???

    // music stuff 
	{ty: 'emoji', src: '2669..266C'}, // notes
	{ty: 'emoji', src: '266E'}, // notes
	{ty: 'map', src: '266D', dst: '0062'}, // map b flat to "b"
	{ty: 'map', src: '266F', dst: '0023'}, // map # sharp to "#"



	/*
	// hummm
	'2596..259F', // QUADRANTS
	'25A0..25EF', // SHAPES

    // 00A2 = ¢
    // 0024 = $
    
    // 263A = ☺
    // 263B = ☻ 
	*/
];