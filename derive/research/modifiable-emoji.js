import {UNICODE} from '../unicode-version.js';

let skin = new Set();
let hair = new Set();
for (let info of UNICODE.emoji_skin_colors()) {
    skin.add(info.cp);
}
for (let info of UNICODE.emoji_hair_colors()) {
    hair.add(info.cp);
}

let before = new Set();
for (let info of [Object.values(UNICODE.emoji_zwjs()), Object.values(UNICODE.emoji_seqs())].flat(Infinity)) {
   let {cps} = info;
    for (let i = 1; i < cps.length; i++) {
        if (skin.has(cps[i])) {
            before.add(cps[i-1]);
        }
        if (hair.has(cps[i])) {
            before.add(cps[i-2]);
        }
    }
}

console.log({skin, hair});

console.log(before.size);
console.log(JSON.stringify([...before].sort((a, b) => a - b)));