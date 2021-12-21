import {consume_emoji_sequence} from './emoji.js';
import {parse_cp_sequence} from './utils.js';

let cps = parse_cp_sequence('1F468 200D 2764 FE0F 200D 1F468');

console.log(consume_emoji_sequence(cps, 0));