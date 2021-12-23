# ens-normalize.js
1-file, 1-function, 1-argument, 0-dependancy Compact ES6 Ethereum Name Service (ENS) Name Normalizer.

* <span style="color:#f88">Currently using experimental ideas!</span>
* Uses Unicode v14.0.0
* Uses [UTS-46](https://unicode.org/reports/tr46/) w/IDNA2008
* Uses [UTS-51](https://unicode.org/reports/tr51/)
* Handles [`ContextJ`](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1)
* Handles [`ContextO`](https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3)
* Handles [Emoji ZWJ Sequences](https://unicode.org/emoji/charts/emoji-zwj-sequences.html)
* Handles [Punycode](https://datatracker.ietf.org/doc/html/rfc3492), adapted from [mathiasbynens/punycode.js](https://github.com/mathiasbynens/punycode.js)
---

* [Demo: Resolver](https://adraffy.github.io/ens-normalize.js/test/resolver.html) 
* [Demo: Tokenizer](https://adraffy.github.io/ens-normalize.js/test/tokenizer.html)
* ~~Passes **100%** [IDNATestV2](https://adraffy.github.io/ens-normalize.js/test/report-idna.html)~~ (This test is IDNA2003)
* Passes **100%** [NormalizationTests](https://adraffy.github.io/ens-normalize.js/test/report-nf.html)
* [Emoji Test](https://adraffy.github.io/ens-normalize.js/test/report-emoji.html)
* Generated Report vs `eth-ens-namehash` [Latest version](https://adraffy.github.io/ens-normalize.js/test/output/ens2.html) • [Prior (IDNA2003)](https://adraffy.github.io/ens-normalize.js/test/output/ens.html)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalize';
// browser: 
// 'https://unpkg.com/@adraffy/ens-normalize@latest/dist/ens-normalize.min.js'
// alternatives:
// - ens-normalize-xbidi.min.js (no CheckBidi)
// - ens-normalize-xnfc.min.js (use default String.normalize)
// see: /dist/ for more

// single-function one-argument API
// - ens_normalize(string): string
let normalized = ens_normalize('🚴‍♂️.eth'); // throws if error
// ready for namehash

// errors:
// - not a string
// - contains disallowed character
// - punycode error
// - label has double-hyphen
// - label starts/ends with hyphen
// - label starts with combining mark
// - character out of context
// - bidi error

// note: does not enforce .eth TLD 3-character minimum
```
---

## Building

* Clone to access `build/`.  The actual source is in `build/lib-normalize.js`.  You can run this file directly.
* Run `node build/unicode.js download` to download data from [unicode.org](https://www.unicode.org/Public/).
* Run `node build/unicode.js parse` to parse those files into JSON files.
* Run `node build/build-tables.js` to extract the necessary tables as JSON and generate compressed tables as binary.
* Run `npm run test-source` to test `build/lib-normalize.js`.
* Run `npm run build ` or `node build/build.js` to inject the compressed tables into the source template and create the normal and minified `dist/` files.
* Run `npm run test-build` to test `dist/ens-normalize.js`.