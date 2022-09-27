# ens-normalize.js
0-dependancy Compact ES6 [Ethereum Name Service](https://ens.domains/) (ENS) Name Normalizer that works in the browser.

* Follows [ENS Name Normalization Standard](https://github.com/adraffy/ensip-norm/blob/main/draft.md)
* Passes [**100%**](https://adraffy.github.io/ens-norm-tests/test-validation/output/ens_normalize_1.6.3.html) Validation Tests
* Custom [`NFC`](https://unicode.org/reports/tr15/) Implementation (or use native)
	* Passes [**100%**](https://adraffy.github.io/ens-normalize.js/test/report-nf.html) Unicode `15.0.0` [Normalization Tests](https://www.unicode.org/Public/15.0.0/ucd/NormalizationTest.txt)
* Minified File Sizes: 
	* [`23KB`](./dist/index-xnf.min.js) — native `NFC` via [nf-native.js](./src/nf-native.js) using `String.normalize()`
	* [`32KB` **Default** ](./dist/index.min.js) — custom `NFC` via [nf.js](./src/nf.js)
	* [`39KB`](./dist/all.min.js) *Everything!* — custom `NFC` + [@adraffy/punycode.js](https://github.com/adraffy/punycode.js) + sub-libraries: [dns.js](./src/dns.js), [parts.js](./src/parts.js), [utils.js](./src/utils.js)
* [**Resolver Demo**](https://adraffy.github.io/ens-normalize.js/test/resolver.html)
* [List of Supported Emoji](https://adraffy.github.io/ens-normalize.js/test/emoji.html)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalize';
// npm i @adraffy/ens-normalize
// browser: https://cdn.jsdelivr.net/npm/@adraffy/ens-normalize@latest/dist/index.min.js

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

Normalize name fragments for [substring search](./test/fragment.js):
```Javascript
// these fragments fail ens_normalize() due to ens_normalize_post_check() rules
// but will normalize fine as fragments
let frag1 = ens_normalize_fragment('AB--');
let frag2 = ens_normalize_fragment('\u{303}');

// positional logic is delayed until Post-check:
let norm_gTLD = ens_normalize_post_check('eth');
```

Instead of exposing an IDNA-like API (`is_valid()`, `get_mapped()`, etc.), this library exposes a single function which converts names to tokens:
```JavaScript
// string -> Token[]
// never throws
let tokens = ens_tokenize('_R💩\u{FE0F}a\u{FE0F}\u{304}\u{AD}./');
// [
//     { type: 'isolated', cp: 95 }, // valid w/restrictions
//     {                             // (eg. no combining marks)
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

* `git clone` this repo, then `npm install` 
* Follow instructions in [/derive/](./derive/) to generate data files
	* `npm run derive` 
		* [spec.json](./derive/output/spec.json)
		* [nf.json](./derive/output/nf.json)
		* [nf-tests.json](./derive/output/nf-tests.json)
* `npm run make` — compress data files from `/derive/output/`
	* [include-ens.js](./src/include-ens.js)
	* [include-nf.js](./src/include-nf.js)
* Follow instructions in [/validate/](./validate/) to generate validation tests
	* `npm run validate`
		* [tests.json](./validate/tests.json)
* `npm run test` — perform validation tests
* `npm run build` — create `/dist/`
* `npm run rebuild` — run all the commands above
