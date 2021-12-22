import {consume_emoji_sequence} from './emoji.js';
import {parse_cp_sequence} from './utils.js';

/*
console.log(consume_emoji_sequence(parse_cp_sequence('1F3F4 E0067 E0062 E0065 E006E E0067 E007F'), 0));
console.log(consume_emoji_sequence(parse_cp_sequence('1F468 200D 2764 FE0F 200D 1F468'), 0));
console.log(consume_emoji_sequence(parse_cp_sequence('0023 20E3'), 0));
console.log(consume_emoji_sequence(parse_cp_sequence('0023 FE0F 20E3'), 0));
console.log(consume_emoji_sequence(parse_cp_sequence('0030 FE0F 20E3'), 0));
*/

console.log(consume_emoji_sequence(parse_cp_sequence('1F9D4 200D 2642 FE0F'), 0));

console.log(consume_emoji_sequence(parse_cp_sequence('2642 FE0F'), 0));

console.log(consume_emoji_sequence(parse_cp_sequence('1f4a9'), 0));

