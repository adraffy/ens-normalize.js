

import {ens_normalize_fragment} from "../src/lib.js";
import {MAX_CP, bytes_from_utf8} from './utils.js';

const dist = {};
for (let cp = 0; cp <= MAX_CP; ++cp) {
    try {
        const before = String.fromCodePoint(cp);
        const after = ens_normalize_fragment(before);
        const diff = String(bytes_from_utf8(after).length - bytes_from_utf8(before).length);
        dist[diff] = (dist[diff] ?? 0) + 1;
        //if (diff < 0) console.log(diff, before);
    } catch {}
}
console.log(dist);
console.table(dist);

// {
//   '0': 159669,
//   '1': 419,
//   '2': 63,
//   '3': 192,
//   '5': 8,
//   '6': 40,
//   '9': 23,
//   '12': 14,
//   '15': 1,
//   '-2': 638,
//   '-1': 896,
//   '-3': 800,
//   '-4': 244
// }
