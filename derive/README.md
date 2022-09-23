# Derive Data Files

* Independent of parent repo

## Data Files

* `node download.js` — download latest Unicode data files
	* Uses `Node 18` for `fetch()`
	* Download older version: `node download.js 12.1.0` 
	* Already included: [Unicode 11-15](./data/)
* `node parse-cldr.js` — download latest CLDR files
	* These aren't versioned with Unicode!
		* [regions.json](./data/regions.json)

## Instructions

1. edit [Unicode Version](./unicode-version.js)
1. edit [Rules Files](#rule-files)
1. `node make.js` — creates `/output/` with data files

## Rule Files

* [chars-valid.js](./rules/chars-valid.js)
* [chars-mapped.js](./rules/chars-mapped.js)
* [chars-disallow.js](./rules/chars-disallow.js) 
* [chars-isolated.js](./rules/chars-isolated.js) — valid w/extra restrictions
* [emoji-demoted.js](./rules/emoji-demoted.js) — emoji procssed as text
* [emoji-seq-whitelist.js](./rules/emoji-seq-whitelist.js)
* [emoji-seq-blacklist.js](./rules/emoji-seq-blacklist.js)

## Helpers

* `node names.js 61..7A 200D` — print Unicode names for hex codepoints
* `node names.js -- abc` — print Unicode names for everything after `--`
* `node demoji.js` — print emoji that were mapped by IDNA
* `node emoji-new.js` — print emoji added since Unicode version
