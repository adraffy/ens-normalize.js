# ens-normalize.js
0-dependancy Compact ES6 Ethereum Name Service (ENS) Name Normalizer.

* Passes **100%** [ENSIP Norm Validation Tests](https://adraffy.github.io/ensip-norm/) [(Latest)](https://adraffy.github.io/ens-norm-tests/test-validation/output/ens_normalize_1.5.0.html)
* Filesize: 20KB
* [Demo](https://adraffy.github.io/ens-normalize.js/test/resolver.html)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalize';
// npm i @adraffy/ens-normalize
// browser: https://unpkg.com/@adraffy/ens-normalize@latest/dist/index.min.js

// Primary API: string -> string
let normalized = ens_normalize('🚴‍♂️.eth'); // throws on invalid names
// ready for namehash
// note: does not enforce .eth TLD 3-character minimum
```
Instead of exposing an IDNA-like API (`is_valid()`, `get_mapped()`, etc.), this library exposes a single function which converts names to tokens:
```JavaScript
// Secondary API: string -> Token[]
// turn a name into a list of tokens
let tokens = ens_tokenize('R💩\uFE0Fa\xAD./'); // never throws
// [
//     { 
//         type: 'mapped', 
//         cp: 82,         // input
//         cps: [ 114 ]    // output
//     }, 
//     { 
//         type: 'emoji',
//         input: [ 128169, 65039 ],  // input 
//         emoji: [ 128169, 65039 ],  // ideal form
//         cps: [ 128169 ]            // output
//     },
//     { type: 'valid', cps: [ 97 ] },
//     { type: 'ignored', cp: 173 },
//     { type: 'stop' },
//     { type: 'disallowed', cp: 47 }
// ]
```

## Build

* `npm run make` compress data from [@adraffy/ensip-norm](https://adraffy.github.io/ensip-norm/)
* `npm run test` run validation tests
* `npm run build` create `/dist/`
* `npm run build-dev` compile `parts.js`, `dns.js`, and `all.js`