# Derive Data Files

* Independent of parent repo

## Instructions

1. (optional) `node download.js 15` — download Unicode 15.0.0 files
	* Uses `Node 18` for `fetch()`
1. `node make.js` — creates `/output/` with data files
	* Current version specification: [unicode-version.js](./unicode-version.js)

## Rule Files

* [chars-valid.js](./rules/chars-valid.js)
* [chars-mapped.js](./rules/chars-mapped.js)
* [chars-disallow.js](./rules/chars-disallow.js) 
* [picto-promoted.js](./rules/picto-promoted.js) — non-emoji characters handled by extended pictographic processing (= emoji)
* [emoji-demoted.js](./rules/emoji-demoted.js) — emoji characters handled by text processing
* [emoji-seq-whitelist.js](./rules/emoji-seq-whitelist.js)
* [emoji-seq-blacklist.js](./rules/emoji-seq-blacklist.js)

## Helpers

* `node names.js 61..7A 200D` — print Unicode names for hex codepoints
* `node names.js -- abc` — print Unicode names for everything after `--`
* `node demoji.js` — print emoji that were mapped by IDNA
* `node emoji-new.js` — print emoji added since Unicode version
