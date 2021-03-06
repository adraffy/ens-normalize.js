# ens-normalize.js
1-file, 1-function, 1-argument, 0-dependancy Compact ES6 Ethereum Name Service (ENS) Name Normalizer.

* Uses Unicode v14.0.0 + [UTS-51](https://unicode.org/reports/tr51/) + [UTS-46](https://unicode.org/reports/tr46/) w/IDNA2008
* Handles [`ContextJ/ContextO`](https://github.com/adraffy/ens-normalize.js/blob/main/build/context.js)
* Handles [`CheckBidi`](https://github.com/adraffy/ens-normalize.js/blob/main/build/bidi.js)
* Passes **100%** [IDNATestV2](https://adraffy.github.io/ens-normalize.js/test/report-idna.html) (Using `uts46` Payload)
* Handles [Emoji ZWJ Sequences](https://unicode.org/emoji/charts/emoji-zwj-sequences.html)
* Passes **100%** [Emoji Sequences](https://adraffy.github.io/ens-normalize.js/test/report-emoji.html) (Using `uts51` Payload)
* Passes **100%** [NormalizationTests](https://adraffy.github.io/ens-normalize.js/test/report-nf.html)
* Ignores [Punycode](https://datatracker.ietf.org/doc/html/rfc3492)

---
* [Demo: Resolver](https://adraffy.github.io/ens-normalize.js/test/resolver.html)
* Generated Report vs `eth-ens-namehash` [Latest version](https://adraffy.github.io/ens-normalize.js/test/output/ens-2.0.15-adraffy-1.3.17.html)

```Javascript
import {ens_normalize} from '@adraffy/ens-normalize';
// browser: 
// 'https://unpkg.com/@adraffy/ens-normalize@latest/dist/ens-normalize.min.js'

// Primary API: string -> string
let normalized = ens_normalize('š“āāļø.eth'); // throws 
// ready for namehash

// errors:
// - not a string
// - contains disallowed character
// - label starts with combining mark
// - character out of context
// - bidi error

// note: does not enforce .eth TLD 3-character minimum
```
Instead of exposing an IDNA-like API (`is_valid()`, `get_mapped()`, etc.), this library converts names to tokens for use in providing a better UX for end-users.  Also, see: <b>parts.js</b> submodule below.
```JavaScript
// Secondary API: string -> [{tokens,...}]
// turn a name into a list of tokens
let tokens = ens_tokenize('Rš©\uFE0Fa\xAD./'); // never throws
// [
//   {m: [0x72], u:[0x52]},              // mapped u:"R" -> m:"r"
//   {e: [0x1F4A9], u:[0x1F4A9,0xFE0F]}, // emoji: u:"š©" -> e:"š©"
//   {v: [0x61]},                        // valid: "a"
//   {i: 0xAD},                          // ignored: \xAD
//   {},                                 // stop: "."
//   {d: 0x2F}                           // disallowed: "/"
// ]
```
### Independent submodules:
```Javascript
// Unicode Normalized Forms
// see: build/nf.js (algo)
// see: build/lib-nf.js (api)
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
import {nfc, nfd} from 'dist/nf.min.js';
// {nfc,nfd}(string): string

// CheckBidi 
// see: build/bidi.js (algo)
// see: build/lib-bidi.js (api)
// see: https://www.rfc-editor.org/rfc/rfc5893.html#section-2
import {check_bidi, is_bidi_domain_name} from 'dist/bidi.min.js';
// is_bidi_domain_name(string): bool
// check_bidi(string) throws

// Parts -- generate HTML from parsed tokens
// see: build/lib-parts.js (api)
// see: https://adraffy.github.io/ens-normalize.js/test/report-emoji.html
import {dom_from_tokens, use_default_style} from 'dist/parts.min.js';
// use_default_style(); installs a stylesheet
// DOMNode.append(dom_from_tokens(ens_tokenize('raffy.eth')));
```

## Building

* Clone to access `build/`.  The actual source is in `build/lib-normalize-release.js`.  You can run this file directly.
* Run `node build/unicode.js download` to download data from [unicode.org](https://www.unicode.org/Public/).
* Run `node build/unicode.js parse` to parse those files into JSON files.
* Run `node build/build-tables.js all` to build compressed rule payloads.
* Run `node build/build.js` to inject the compressed tables into the source templates and create multiple `dist/` files.
* Run `node test/test-validation-test.js` to test the default library.