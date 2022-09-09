# ens-normalize.js
0-dependancy Compact ES6 [Ethereum Name Service](https://ens.domains/) (ENS) Name Normalizer that works in the browser.

* Passes [**100%**](https://adraffy.github.io/ens-norm-tests/test-validation/output/ens_normalize_1.6.0.html) ENSIP Norm [Validation Tests](https://github.com/adraffy/ensip-norm/)
* Custom `NFC` [Implementation](https://unicode.org/reports/tr15/) (or use native)
	* Passes [**100%**](https://adraffy.github.io/ens-normalize.js/test/report-nf.html) Unicode `14.0.0` [Normalization Tests](https://www.unicode.org/Public/14.0.0/ucd/NormalizationTest.txt)
* Minified File Sizes: 
	* [`21KB`](./dist/index-xnf.min.js) — using native `NFC` via `String.normalize()`
	* [`30KB` **Default** ](./dist/index.min.js) — using custom `NFC`
	* [`36KB`](./dist/all.min.js) — *everything* (custom `NFC` + sub-libraries: [nf.js](./src/nf.js), [dns.js](./src/dns.js), [parts.js](./src/parts.js), [utils.js](./src/utils.js))
* [**Resolver Demo**](https://adraffy.github.io/ens-normalize.js/test/resolver.html)

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
// works like ens_normalize
// output ready for display
let pretty = ens_beautify('1⃣2⃣.eth'); 
// "1️⃣2️⃣.eth"

// note: normalization is unchanged:
// ens_normalize(ens_beautify(x)) == ens_normalize(x)
```

Normalize name fragments:
```Javascript
// these fragments fail ens_normalize() due to ens_normalize_post_check() rules
// but will normalize fine as fragments
let frag1 = ens_normalize_fragment('AB--');
let frag2 = ens_normalize_fragment('\u{303}');

// structural logic is delayed until Post-check:
let norm_gTLD = ens_normalize_post_check('eth');
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

Generates an array of supported emoji codepoints:
```Javascript
// () -> number[][]
console.log(ens_emoji());
// [
//     [ 2764 ],
//     [ 128169, 65039 ],
//     [ 128105, 127997, 8205, 9877, 65039 ],
//     ...
// ]
```

## Build

* `npm run make` compress data from [@adraffy/ensip-norm](https://github.com/adraffy/ensip-norm/)
* `npm run test` run validation tests
* `npm run build` create `/dist/`