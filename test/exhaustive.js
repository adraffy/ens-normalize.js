// compute a signature from each table
// compare with mathematica

import {is_disallowed, is_ignored, is_combining_mark, get_mapped} from '../ens-normalize.js';
import {KeccakHasher} from '@adraffy/keccak';

let N = 0x20000; // unicode range [0,N)

function member_signature(fn) {
    let h = KeccakHasher.sha3();
    for (let i = 0; i < N; ) {
        let u32 = 0;
        for (let e = Math.min(N, i + 32); i < e; i++) {
            if (fn(i)) {
                u32 |= 1 << (i & 0x1F);     
            }   
        }
        h._add_block(u32);
    }
    return h.finalize().hex;
}

function mapped_signature() {
    let h = KeccakHasher.sha3();
    for (let i = 0; i < N; i++) {
        let x = get_mapped(i);
        if (!x) continue;
        if (typeof x == 'number') x = [x];
        h.update(String.fromCodePoint(...x));
    }
    return h.finalize().hex;
}

console.log(member_signature(is_disallowed));
console.log(member_signature(is_ignored));
console.log(member_signature(is_combining_mark));
console.log(mapped_signature());

/*
6454ee55fa67e6da83ac83e95764ff793746f5d59cf6ef5c7257158c640ad565
8231363f11f483d708f445f4697b9d56595c3ec6ee95a62a522b7199e58014ef
a50557cab87875991dcbe1f03b0ae17877490763b2a86facd3e89be81bad15dd
4d3d7753887cebd7ff0c3aa756e4d033a4f876fdd3768569e96464c49585e78a
*/