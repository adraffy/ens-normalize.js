# Validation Tests Generator

* Depends on `/derive/`
* Depends on [current implementation](../) of `ens_normalize()`
* Depends on [@adraffy/ens-labels](https://github.com/adraffy/ens-labels)

## Data Files (not included)

* `node download-labels.js` — create cache of known labels
	* [labels.json](./labels.json)
	* Uses built-in `fetch()`
* `node random-names.js` — create cache of random names
	* [random-names.json](./random-names.json)

## Instructions

1. `node make.js` — creates [tests.json](./tests.json)
	* Check output for any warnings
1. `npm run test` — run latest validation tests
