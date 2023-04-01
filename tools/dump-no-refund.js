import {writeFileSync} from 'node:fs';
import {read_labels} from '../validate/data.js';
import {ens_normalize, ens_tokenize} from '../src/lib.js';
import {str_from_cps} from '../src/utils.js';
import eth_ens_namehash from '../test/eth-ens-namehash@2.0.15.min.js';

// from examples.js
function filter_emoji(s) {
	return str_from_cps(ens_tokenize(s).flatMap(token => {
		switch (token.type) { 
			case 'emoji': return []; // ignore
			case 'nfc': return token.input; // pre-nfc
			case 'mapped':
			case 'valid': return token.cps;
			default: return token.cp;
		}
	}));
}

let found = 0;
let spoof_invis = [];

for (let label of read_labels()) {
	if (!label) continue;
	try {
		if (label !== eth_ens_namehash.normalize(label)) continue; // not norm0
	} catch (err) {
		continue; // failed norm0
	}
	let norm;
	try {
		norm = ens_normalize(label);
		if (norm === label) continue; // same
	} catch (err) {
	}
	found++;
	if (norm) {
		// diff norm
	} else {
		// name now illegal
	}
	let emojiless = filter_emoji(label);
	if (/(\uFE0F|\uFE0E|\u200C|\u200D)/u.test(emojiless)) {
		spoof_invis.push(label);
	}
}
console.log({
	found,
	invis: spoof_invis.length,
});

writeFileSync(new URL('./no-refund.json', import.meta.url), JSON.stringify({
	found,
	spoof_invis
}, null, '\t'));
