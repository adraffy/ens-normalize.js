# ens-normalize.js
1-file, 0-dependancy Compact ES6 Ethereum Name Service (ENS) Name Normalizer.


This library is **5-10x smaller** than existing implementations.

Reference: [UTS-46 v14.0.0](https://unicode.org/reports/tr46/)

[Demo](https://raffy.antistupid.com/eth/ens-resolver.html">)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalizer.js';
// browser:
// import {ens_normalize} from 'https://unpkg.com/@adraffy/ens-normalizer@latest/ens-normalizer.js';

'raffy.eth' === ens_normalize('rAfFy.eTh'); // true
ens_normalize('-'); // throws on error

// errors:
// - contains disallowed character
// - puny decode failure
// - label not idna after puny decode
// - label has double-hyphen at [3:4]
// - label starts/ends with hyphen
// - label starts with combining mark

// note:
// does not enforce .eth TLD 3-byte minimum
```

Adapted **Puny Decode** from [mathiasbynens/punycode.js](https://github.com/mathiasbynens/punycode.js).
