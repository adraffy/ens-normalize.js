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

	// prevent digits from being emoji
	{ty: 'demoji', src: '30..39'},

	// add missing emoji
	{ty: 'style-drop', src: '203C'}, // ‼
	{ty: 'style-drop', src: '2049'}, // ⁉

	// disable zwj
	{ty: 'disallow', src: '200C'},
	{ty: 'disallow', src: '200D'},

	// add zwjs 
	...EMOJI_ZWJ,
	// add custom non-RGI zwjs
	...EMOJI_ZWJ_CUSTOM,
	// add seqs
	...EMOJI_SEQ,

	// disable IDNA mapped stops
	// https://discuss.ens.domains/t/ens-name-normalization/8652/7
	{ty: 'disallow', src: '3002 FF0E FF61'},
	
	// allow underscore
	// https://discuss.ens.domains/t/ens-name-normalization/8652/26
	{ty: 'valid', src: '5F'}, // _

	// allow capital currencies
	{ty: 'valid', src: '24'}, // $ (note: 💲 already exists)
	
	// disable Braille Pattern Blank
	// https://discuss.ens.domains/t/ens-name-normalization/8652/203
	{ty: 'disallow', src: '2800'},

];