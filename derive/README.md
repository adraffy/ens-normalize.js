# Derive Data Files

* [Unicode Standard](https://www.unicode.org/versions/latest/)
* [Unicode Technical Standard #46: IDNA](https://www.unicode.org/reports/tr46/)
	* [unicode-logic.js/`derive_idna_rules()`](./unicode-logic.js#L581) — [spec](https://unicode.org/reports/tr46/#Implementation_Notes)
	* [idna.js/`ens_idna_rules()`](./idna.js)
* [Unicode Technical Standard #51: Emoji](https://www.unicode.org/reports/tr51/)
* [Unicode Standard Annex #15: Normalization Forms](https://unicode.org/reports/tr15/)
* [Unicode Standard Annex #24: Script Property](https://www.unicode.org/reports/tr24/)
* [Unicode Standard Annex #29: Text Segmentation](https://unicode.org/reports/tr29/)
* [Unicode Standard Annex #31: Identifier and Pattern Syntax](https://www.unicode.org/reports/tr31/)
	* [script-kinds.json](./data/15.1.0/scripts-kinds.json) — [Excluded](https://www.unicode.org/reports/tr31/#Table_Candidate_Characters_for_Exclusion_from_Identifiers), [Recommended](https://www.unicode.org/reports/tr31/#Table_Recommended_Scripts), [Limited Use](https://www.unicode.org/reports/tr31/#Table_Limited_Use_Scripts)
* [Unicode Technical Standard #39: Security Mechanisms](https://www.unicode.org/reports/tr39/)
	* [unicode-logic.js/`augmented_script_set()`](./unicode-logic.js#L15) — [spec](https://www.unicode.org/reports/tr39/#def-augmented-script-set)
	* [unicode-logic.js/`get_resolved_script_set()`](./unicode-logic.js#L347) — [spec](https://www.unicode.org/reports/tr39/#def-resolved-script-set)
* [RFC-3492: Punycode](https://datatracker.ietf.org/doc/html/rfc3492)
* [RFC-5891: IDNA: Protocol](https://datatracker.ietf.org/doc/html/rfc5891) 
* [RFC-5892: The Unicode Code Points and IDNA](https://datatracker.ietf.org/doc/html/rfc5892)
* [WHATWG URL: IDNA](https://url.spec.whatwg.org/#idna)
* [Unicode data files](https://www.unicode.org/Public/)
	* Download Latest: `node download.js` 
	* To download older version: `node download.js 12.1.0` 
	* Already included: [Unicode 11-16](./data/)
* [CLDR data files](https://github.com/unicode-org/cldr)
	* Download Latest: `node parse-cldr.js`
	* To download older version: `node parse-cldr.js 42` 
	* Already included: [CLDR 42-45](./data/)
	* ⚠️ Versioned separately from Unicode!

## Instructions

1. edit [unicode-version.js](./unicode-version.js) — specify which versions to use
1. edit [Rules Files](./rules/)
1. `node make.js` — creates `/output/` with data files

## [Rules](./rules/)

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
* [group-order.js](./rules/group-order.js) — how groups should be sorted for matching efficiency (auto-generated)

## Helpers

* `node names.js 61..7A 200D` — print Unicode names for hex codepoints
* `node names.js script Latn` — print Unicode names for `Latin`
* `node names.js prop White_Space` — print Unicode names with property `White_Space`
* `node names.js find abc` — find characters by name

## Upgrade Notes

### 16.0.0 → 17.0.0

* TODO
	* Using 16.0.0 Security Files: `IdentifierStatus.txt`, `IdentifierType.txt`, `confusables.txt`, `intentional.txt`
	* Script: Chisoi is incomplete
* [Diff](./diffs/16.0.0-vs-17.0.0.txt) `node unicode-diff.js 16 17`
* UAX-31: 
	* **New** 5 Scripts: Berf, Chis, Sidt, Tayo, Tols
* UTS-51:
	* **New** 164 Emoji `node derive/dump-emoji-new.js`

### 15.1.0 → 16.0.0

* [Release](https://www.unicode.org/versions/Unicode16.0.0/#Character_Additions)
* [Diff](./diffs/15.1.0-vs-16.0.0.txt) `node unicode-diff.js 15.1 16`
* CLDR
	* `short-names.json` **Unchanged**
	* `regions.json` **New** `"CQ"`
* UAX-31: 
	* **New** 7 Scripts: Gara, Gukh, Krai, Onao, Sunu, Todr, Tutg
* UTS-39:
	* **Change** `confusables.txt`
		* `OUTLINED LATIN [AZ]` with `LATIN CAPITAL [AZ]` (no effect, not confusable)
		* `LATIN SMALL LETTER SHARP S` (no effect)
* UTS-46:
	* **Change** IDNA — kept prior behavior
		* `disallowed_STD3_valid` &rarr; `valid`
		* `disallowed_STD3_mapped` &rarr; `mapped`
	* **Change** Various Invisibles/Filler: disallowed &rarr; ignored
	* **Change** `_` and `$` mappings
	* **New** [Legacy Computing Supplement](https://www.unicode.org/charts/PDF/Unicode-16.0/U160-1CC00.pdf)
* UTS-51:
	* **New** 8 Emoji
* Prior Validation: `node test/validate.js 1.10.1` 
	* Fails on new character changes
	* Fails on new emoji

### 15.0.0 → 15.1.0

* [Release](https://www.unicode.org/versions/Unicode15.1.0)
* [Diff](./diffs/15.0.0-vs-15.1.0.txt) `node unicode-diff.js 15 15.1`
* CLDR
	* `short-names.json` **Unchanged**
* UCD:
	* **New** Ideographic Description Characters
	* **New** CJK Ideograph Extension I Block
* UAX-31: 
	* **Unchanged** Scripts 
	* **Unchanged** Recommended, Excluded, Limited Use Scripts
	* **New** Zyyy Script Extensions
* UTS-39: 
	* **New** Confusable Bidi Logic (no effect, since mixed-Bidi not allowed)
	* `confusables.txt` **Unchanged**
* UTS-46: 
	* **Change** `1E9E (ẞ) LATIN CAPITAL LETTER SHARP S` &rarr; `DF (ß) LATIN SMALL LETTER SHARP S`
* UTS-51:
	* **New** 118 Emoji
* Prior Validation: `node test/validate.js 1.9.4`
	* Fails new emoji
