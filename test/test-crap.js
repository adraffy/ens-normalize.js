import {ens_normalize, DEBUG, is_zwnj_emoji} from '../ens-normalize.js';

//console.log(DEBUG.ZWNJ_EMOJI[1]);

let v = [127987, 65039, 8205, 127752, 46, 101, 116, 104];

console.log(is_zwnj_emoji(v, 2));