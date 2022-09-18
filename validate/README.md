# Validation Tests Generator

* Depends on `/derive/`
* Depends on current implementation of `ens_normalize()`

## Instructions

1. `node download-labels.js` — download a set of known labels: `labels.json`
	* Uses `Node 18` for `fetch()`
1. `node random-names.js` — create a cache of names: `random-names.json`
1. `node make.js` — creates `tests.json` 
	* Check output for any warnings
1. `npm run test` — check latest validation with current implementation
