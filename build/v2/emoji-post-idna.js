import DEMOJI from '../rules/demoji.js';
import {read_parsed} from '../nodejs-utils.js';
import {parse_cp_range} from '../utils.js';

let set = new Set(read_parsed('emoji-data').Emoji.flatMap(parse_cp_range));

[
	'1F1E6..1F1FF', // regional
	'1F3FB..1F3FF', // skin
	'1F9B0..1F9B3', // hair
].flatMap(parse_cp_range).forEach(cp => set.add(cp));

[
	'2A', // #
	'23', // *
	'30..39', // 0-9
	...DEMOJI.filter(x => !x.dst).map(x => x.src)
].flatMap(parse_cp_range).forEach(cp => set.delete(cp));

export default set;