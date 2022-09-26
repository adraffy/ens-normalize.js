# Derive Data Files

* Independent of parent repo
* Uses `Node 18` for `fetch()`

## Data Files

* [Unicode Technical Standard #46: IDNA](https://www.unicode.org/reports/tr46/)
	* [unicode-logic.js/`idna_rules()`](./unicode-logic.js) — [src](https://unicode.org/reports/tr46/#Implementation_Notes)
* [Unicode Technical Standard #51: Emoji](https://www.unicode.org/reports/tr51/)
* [Unicode Standard Annex #15: Normalization Forms](https://unicode.org/reports/tr15/)
* [Unicode Standard Annex #31: Script Property](https://www.unicode.org/reports/tr31/)
	* [scripts-excluded.json](./data/scripts-excluded.json) — [src](https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers)
	* [scripts-recommended.json](./data/scripts-recommended.json) — [src](https://www.unicode.org/reports/tr31/#Table_Recommended_Scripts)
	* [scripts-limited-use.json](./data/scripts-limited-use.json) — [src](https://www.unicode.org/reports/tr31/#Table_Limited_Use_Scripts)
* [Unicode Technical Standard #39: Security Mechanisms](https://www.unicode.org/reports/tr39/)
	* [unicode-logic.js/`get_augmented_script_set()`](./unicode-logic.js) — [src](https://www.unicode.org/reports/tr39/#Mixed_Script_Detection)
* [Unicode data files](https://www.unicode.org/Public/)
	* Download Latest: `node download.js` 
	* To download older versions: `node download.js 12.1.0` 
	* Already included: [Unicode 11-15](./data/)
* [CLDR data files](https://github.com/unicode-org/cldr)
	* Download Latest: `node parse-cldr.js` 
		* [regions.json](./data/regions.json)
	* Warning: these aren't versioned with Unicode!

## Instructions

1. edit [unicode-version.js](./unicode-version.js) — specify which version to use
1. edit [Rules Files](./rules/)
1. `node make.js` — creates `/output/` with data files

## Rule Files

* [chars-valid.js](./rules/chars-valid.js)
* [chars-mapped.js](./rules/chars-mapped.js)
* [chars-disallow.js](./rules/chars-disallow.js) 
* [chars-isolated.js](./rules/chars-isolated.js) — valid w/extra restrictions
* [emoji-demoted.js](./rules/emoji-demoted.js) — emoji procssed as text
* [emoji-seq-whitelist.js](./rules/emoji-seq-whitelist.js)
* [emoji-seq-blacklist.js](./rules/emoji-seq-blacklist.js)
* [confusables-Grek.js](./rules/confusables-Grek.js) — Greek confusables
* [confusables-Cyrl.js](./rules/confusables-Cyrl.js) — Cyrillic confusables

## Helpers

* `node names.js 61..7A 200D` — print Unicode names for hex codepoints
* `node names.js -- abc` — print Unicode names for everything after `--`
* `node demoji.js` — print emoji that were mapped by IDNA
* `node emoji-new.js` — print emoji added since Unicode version
