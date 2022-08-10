# ens-normalize.js
0-dependancy Compact ES6 Ethereum Name Service (ENS) Name Normalizer.

* Passes **100%** [ENSIP Norm](https://adraffy.github.io/ensip-norm/) Validation Tests [(Latest)](https://adraffy.github.io/ens-norm-tests/test-validation/output/ens_normalize_1.5.0.html)
* File Size: [`18KB`](./dist/only-norm.min.js)
* [Demo](https://adraffy.github.io/ens-normalize.js/test/resolver.html)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalize';
// npm i @adraffy/ens-normalize
// browser: https://unpkg.com/@adraffy/ens-normalize@latest/dist/index.min.js

// string -> string
// throws on invalid names
// output ready for namehash
let normalized = ens_normalize('RaFFY🚴‍♂️.eTh');
// "raffy🚴‍♂.eth"

// note: does not enforce .eth TLD 3-character minimum
```
Format names with fully-qualified emoji:
```JavaScript
// string -> string
// works like ens_normalize
// output ready for display
let pretty = ens_beautify('1⃣2⃣.eth'); 
// "1️⃣2️⃣.eth"

// note: normalization is unchanged:
// ens_normalize(ens_beautify(x)) == ens_normalize(x)
```

Instead of exposing an IDNA-like API (`is_valid()`, `get_mapped()`, etc.), this library exposes a single function which converts names to tokens:
```JavaScript
// string -> Token[]
let tokens = ens_tokenize('R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./'); // never throws
// [
//     { 
//         type: 'mapped', 
//         cp: 82,         // input
//         cps: [ 114 ]    // output
//     }, 
//     { 
//         type: 'emoji',
//         input: [ 128169, 65039 ],  // input 
//         emoji: [ 128169, 65039 ],  // fully-qualified
//         cps: [ 128169 ]            // output
//     },
//     {
//         type: 'nfc',
//         input: [ 97, 772 ],  // input (before nfc, only valid or mapped)
//         cps: [ 257 ],        // output (after nfc)
//         tokens: [            // tokens (before nfc)
//             { type: 'valid', cps: [ 97 ] },
//             { type: 'ignored', cp: 65039 },
//             { type: 'valid', cps: [ 772 ] }
//         ]
//     },
//     { type: 'ignored', cp: 173 },
//     { type: 'stop' },
//     { type: 'disallowed', cp: 47 }
// ]
```

## Build

* `npm run make` compress data from [@adraffy/ensip-norm](https://adraffy.github.io/ensip-norm/)
* `npm run test` run validation tests
* `npm run build` create `/dist/`