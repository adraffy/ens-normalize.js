

import {ens_normalize} from "../src/lib.js";
import {MAX_CP, bytes_from_utf8} from './utils.js';

const dist = {};
for (let cp = 0; cp <= MAX_CP; ++cp) {
    try {
        const before = String.fromCodePoint(cp);
        const after = ens_normalize(before);
        const diff = String(bytes_from_utf8(after).length - bytes_from_utf8(before).length);
        dist[diff] = (dist[diff] ?? 0) + 1;
    } catch {}
}
console.log(dist);

