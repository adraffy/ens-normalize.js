# ens-normalize.js
1-file, 1-function, 1-argument, 0-dependancy Compact ES6 Ethereum Name Service (ENS) Name Normalizer.

* Passes **100%** [ENSIP Norm Validation Tests](https://adraffy.github.io/ensip-norm/)
* [Demo: Resolver](https://adraffy.github.io/ens-normalize.js/test/resolver.html)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalize';
// npm i @adraffy/ens-normalize
// browser: https://unpkg.com/@adraffy/ens-normalize@latest/dist/index.min.js

// Primary API: string -> string
let normalized = ens_normalize('🚴‍♂️.eth'); // throws 
// ready for namehash
// note: does not enforce .eth TLD 3-character minimum
```
Instead of exposing an IDNA-like API (`is_valid()`, `get_mapped()`, etc.), this library converts names to tokens for use in providing a better UX for end-users. 
```JavaScript
// Secondary API: string -> Token[]
// turn a name into a list of tokens
let tokens = ens_tokenize('R💩\uFE0Fa\xAD./'); // never throws
// [
//     { 
//         type: 'mapped', 
//         cp: 82,                      // input
//         cps: [ 114 ]                 // output
//     }, 
//     { 
//         type: 'emoji',
//         input: [ 128169, 65039 ],    // input 
//         emoji: [ 128169, 65039 ],    // ideal form
//         cps: [ 128169 ]              // output
//     },
//     { type: 'valid', cps: [ 97 ] },
//     { type: 'ignored', cp: 173 },
//     { type: 'stop' },                // label-break: '.'
//     { type: 'disallowed', cp: 47 }
// ]
```

## Build

* `npm run make` compress data from [@adraffy/ensip-norm](https://adraffy.github.io/ensip-norm/)
* `npm run test` run validation tests
* `npm run build` create `/dist/`
* `npm run build-dev` compile `parts.js`, `dns.js`, and `all.js`