import {UNICODE} from '../unicode-version.js';

console.log(UNICODE.regional_indicators());

let flags = UNICODE.valid_emoji_flag_sequences();
console.log(flags.length);
console.log(flags[0]);
