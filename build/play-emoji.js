import {consume_emoji_sequence} from './emoji.js';
import {parse_cp_sequence} from './utils.js';

console.log(consume_emoji_sequence(parse_cp_sequence('1F468 200D 2764 FE0F 200D 1F468'), 0));
console.log(consume_emoji_sequence(parse_cp_sequence('0023 20E3'), 0));
console.log(consume_emoji_sequence(parse_cp_sequence('0023 FE0F 20E3'), 0));