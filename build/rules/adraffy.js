import STYLE_DROP from './style-drop.js';
import DEMOJI from './demoji.js';
import EMOJI_ZWJ from './emoji-zwj.js';
import EMOJI_ZWJ_CUSTOM from './emoji-zwj-custom.js';
import EMOJI_SEQ from './emoji-seq.js';

export default  [
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
	{ty: 'style-drop', src: '1F1E6..1F1FF'}, 

	// add zwjs 
	...EMOJI_ZWJ,
	// add custom non-RGI zwjs
	...EMOJI_ZWJ_CUSTOM,
	// add seqs
	...EMOJI_SEQ,

	// prevent arbitrary tag-seqs
	{ty: 'disable-tags'},

	// enable new emoji
	{ty: 'style-req', src: '2049'}, // ?!
	{ty: 'style-req', src: '203C'}, // !!

	// disable IDNA mapped stops
	// https://discuss.ens.domains/t/ens-name-normalization/8652/7
	{ty: 'disallow', src: '3002 FF0E FF61'},

	// disable combining low line
	// https://discuss.ens.domains/t/ens-name-normalization/8652/62
	//{ty: 'disallow', src: '332'},

	// allow underscore
	// https://discuss.ens.domains/t/ens-name-normalization/8652/26
	{ty: 'valid', src: '5F'}, // _

	// allow capital currencies
	{ty: 'valid', src: '24'}, // $ -> 💲 already exists
	//{ty: 'valid', src: 'A2'}, // ¢ vs looks like little-c
	{ty: 'valid', src: 'A3'}, // £ vs ₤
	{ty: 'valid', src: 'A5'},   // ¥
	{ty: 'valid', src: '20AC'}, // €
	{ty: 'valid', src: '20BF'}, // ₿

	// map indic digits to arabic digits
	// https://discuss.ens.domains/t/ens-name-normalization/8652/172
	{ty: 'map', src: '6F0', dst: '660'},
	{ty: 'map', src: '6F1', dst: '661'},
	{ty: 'map', src: '6F2', dst: '662'},
	{ty: 'map', src: '6F3', dst: '663'},
	//{ty: 'mapped', src: '6F4', dst: '664'},
	//{ty: 'mapped', src: '6F5', dst: '665'},
	//{ty: 'mapped', src: '6F6', dst: '666'},
	//{ty: 'mapped', src: '6F7', dst: '667'},
	{ty: 'map', src: '6F8', dst: '668'},
	{ty: 'map', src: '6F9', dst: '669'},


	// path-like combining marks
	// Combining Long Solidus Overlay	
	//{ty: 'disallow', src: '338'}, // looks like /
	// Combining Short Stroke Overlay 
	//{ty: 'disallow', src: '335'}, // looks like -

	// https://en.wikipedia.org/wiki/Spacing_Modifier_Letters
	{ty: 'disallow', src: '02B0..02FF'},

	// https://en.wikipedia.org/wiki/Interpunct
	{ty: 'disallow', src: 'A78F'},

];