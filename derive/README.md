# Derive Data Files

* Independent of parent repo
* Uses built-in `fetch()`

## Resources

* [Unicode Technical Standard #46: IDNA](https://www.unicode.org/reports/tr46/)
	* [unicode-logic.js/`idna_rules()`](./unicode-logic.js) — [src](https://unicode.org/reports/tr46/#Implementation_Notes)
* [Unicode Technical Standard #51: Emoji](https://www.unicode.org/reports/tr51/)
* [Unicode Standard Annex #15: Normalization Forms](https://unicode.org/reports/tr15/)
* [Unicode Standard Annex #24: Script Property](https://www.unicode.org/reports/tr24/)
* [Unicode Standard Annex #31: Identifier and Pattern Syntax](https://www.unicode.org/reports/tr31/)
	* [scripts-excluded.json](./data/scripts-excluded.json) — [src](https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers)
	* [scripts-recommended.json](./data/scripts-recommended.json) — [src](https://www.unicode.org/reports/tr31/#Table_Recommended_Scripts)
	* [scripts-limited-use.json](./data/scripts-limited-use.json) — [src](https://www.unicode.org/reports/tr31/#Table_Limited_Use_Scripts)
* [Unicode Technical Standard #39: Security Mechanisms](https://www.unicode.org/reports/tr39/)
	* [unicode-logic.js/`get_augmented_script_set()`](./unicode-logic.js) — [src](https://www.unicode.org/reports/tr39/#Mixed_Script_Detection)
* [RFC-3492: Punycode](https://datatracker.ietf.org/doc/html/rfc3492)
* [RFC-5891: IDNA: Protocol](https://datatracker.ietf.org/doc/html/rfc5891) 
* [RFC-5892: The Unicode Code Points and IDNA](https://datatracker.ietf.org/doc/html/rfc5892)
* [WHATWG URL: IDNA](https://url.spec.whatwg.org/#idna)
* [Unicode data files](https://www.unicode.org/Public/)
	* Download Latest: `node download.js` 
	* To download older versions: `node download.js 12.1.0` 
	* Already included: [Unicode 11-15](./data/)
* [CLDR data files](https://github.com/unicode-org/cldr)
	* Download Latest: `node parse-cldr.js` 
	* Already included: [CLDR 42](./data/CLDR-42/)
	* Warning: these aren't versioned with Unicode!

## Instructions

1. edit [unicode-version.js](./unicode-version.js) — specify which versions to use
1. edit [Rules Files](./rules/)
1. `node make.js` — creates `/output/` with data files

## Rule Files

* [chars-valid.js](./rules/chars-valid.js)
* [chars-ignored.js](./rules/chars-ignored.js)
* [chars-mapped.js](./rules/chars-mapped.js)
* [chars-disallow.js](./rules/chars-disallow.js) 
* [chars-fenced.js](./rules/chars-fenced.js) — characters that occur in the middle and can't touch
* [chars-escape.js](./rules/chars-escape.js) — characters that should be escaped
* [emoji.js](./rules/emoji.js) — various emoji configurations
* [cm.js](./rules/cm.js) — combining mark sequence whitelist
* [scripts.js](./rules/scripts.js) — various script configurations
* [confuse.js](./rules/confuse.js) — confusables groups
* [group-order.js](./rules/group-order.js) — how groups should be sorted for matching efficiency

## Helpers

* `node names.js 61..7A 200D` — print Unicode names for hex codepoints
* `node names.js script Latn` — print Unicode names for `Latin`
* `node names.js prop White_Space` — print Unicode names with property `White_Space`
* `node names.js find abc` — find characters by name
