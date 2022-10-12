import {UNICODE} from '../unicode-version.js';

let emoji_chrs = new Map(UNICODE.emoji_data().Emoji.map(x => [x.cp, x]));
let emoji_seqs = UNICODE.emoji_seqs();
for (let info of emoji_seqs.Basic_Emoji) {
    let {cps} = info;
    if (cps.length == 1 || (cps.length == 2 && cps[1] === 0xFE0F)) {
        if (!emoji_chrs.delete(cps[0])) {
            throw new Error('expected emoji');
        }
    } else {
        throw new Error('expected basic');
    }
}

// this should be keycap parts (0-9*#) and regionals
console.log(emoji_chrs);
