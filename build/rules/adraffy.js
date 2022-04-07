import STYLE_DROP from './style-drop.js';
import DEMOJI from './demoji.js';
import EMOJI_ZWJ from './emoji-zwj.js';
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

];