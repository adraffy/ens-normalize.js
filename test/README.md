### Tests

* [`validate.html`](./validate.html) → in-browser [ENSIP-15 Validation Tests](https://adraffy.github.io/ens-normalize.js/test/validate.html)
* [`report-nf.html`](./report-nf.html) → in-browser [Unicode NormalizationTest](https://adraffy.github.io/ens-normalize.js/test/report-nf.html)
* `npm run test`
	* [`coder.js`](./coder.js) — verify compression
	* [`nf.js`](./nf.js) — run Unicode NormalizationTest
	* [`validate.js`](./validate.js) — run ENSIP-15 Validation Tests
	* [`init.js`](./init.js) — initialization performance
* [`play.js`](./play.js) — [README.md](../README.md) examples

### Tools

* [`resolver.html``](./resolver.html) → [**Resolver Demo**](https://adraffy.github.io/ens-normalize.js/test/resolver.html) ⭐
* [`emoji.html`](./emoji.html) → [Supported Emoji](https://adraffy.github.io/ens-normalize.js/test/emoji.html)
* [`chars.html`](./chars.html) → [Character Viewer](https://adraffy.github.io/ens-normalize.js/test/chars.html)
* [`confused.html`](./confused.html) → [Confused Explainer](https://adraffy.github.io/ens-normalize.js/test/confused.html)


### Snippets

* [`examples.js`](./examples.js) — common usages not included in library
* [`fragment.js`](./fragment.js) — how to correctly search for names

### External 

* [`eth-ens-namehash@2.0.15.min.js`](eth-ens-namehash@2.0.15.min.js) — [commit `f62f351`](https://github.com/ensdomains/eth-ens-namehash/commit/f62f351f8c646b337da2e1eb458a9ea091f35ce7) modified to build as ESM
* [adraffy/ens-norm-tests](https://github.com/adraffy/ens-norm-tests) — additional normalization tests