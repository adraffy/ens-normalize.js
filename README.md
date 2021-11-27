# ens-normalize.js
1-file, 0-dependancy Compact ES6 Ethereum Name Service (ENS) Name Normalizer.

* Uses latest specification: [UTS-46 v14.0.0](https://unicode.org/reports/tr46/)
* Handles [ZWNJ](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2)/[ZWJ](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2) in `ContextJ`
* Handles (and upgrades) [Emoji ZWJ Sequences](https://unicode.org/emoji/charts/emoji-zwj-sequences.html)
* Handles [Punycode](https://datatracker.ietf.org/doc/html/rfc3492), adapted from [mathiasbynens/punycode.js](https://github.com/mathiasbynens/punycode.js)

[Demo](https://raffy.antistupid.com/eth/ens-resolver.html)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalize';
// browser: 
// 'https://unpkg.com/@adraffy/ens-normalize@latest/dist/ens-normalize.min.js'

// example:
let normalized = ens_normalize('🚴‍♂️.eth'); // throws if error
// this value is ready for hashing

// optional argument: ignore_disallowed (default: false)
// when truthy, disallowed characters are ignored 
ens_normalize('_')       // throws: disallowed
ens_normalize('_', true) // === ''

// errors:
// - not a string
// - contains disallowed character if !ignore_disallowed
// - puny decode failure
// - label has double-hyphen at [3:4]
// - label starts/ends with hyphen
// - label starts with combining mark

// note: does not enforce .eth TLD 3-byte minimum
```

---

## Build Notes

* Clone the repo to access `test/`.  These files are not included in the npm version.
* The actual source is in `test/ens-normalize.src.js`.  Use `npm run render` after modification to build a new `ens-normalize.js`.  
* Use `npm run dist` to build the minified version.