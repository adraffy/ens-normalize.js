import {ens_tokenize, ens_normalize_post_check} from './lib.js';

// EXPERIMENTAL

const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const EMOJI = 0x110000; // MAX CP + 1

/*
function enforce_leading_underscores(cps) {
	let pos = cps.lastIndexOf(UNDERSCORE);
	for (let i = pos - 1; i >= 0; i--) {
		if (cps[i] !== UNDERSCORE) {
			throw new Error('underscore must be leading');
		}
	}
}

function CheckHyphens(cps) {
	let n = cps.length;
	if (n > 0 && cps[0] === HYPHEN) throw new Error('leading hyphen');
	if (n > 1 && cps[n - 1] === HYPHEN) throw new Error('trailing hyphen');
	if (n >= 4 && cps[2] === HYPHEN && cps[3] === HYPHEN) throw new Error('label extension');
}

function enforce_runs(cps, cp, max) {
	let last = 0;
	while (true) {
		let pos = cps.indexOf(cp, last);
		if (pos < 0) break;
		last = pos + 1;
		while (last < cps.length && cps[last] === HYPHEN) last++;
		if (last - pos > max) throw new Error(`too many "${String.fromCodePoint(cp)}" (${last - pos} > ${max})`);
	}
}
*/

function is_safe_text_emoji(cp) {
	return false;
}

function validate_label(cps0, cps) {
	//if (cps0.every(cp => cp < 0x80)) CheckHyphens(cps);
	//enforce_leading_underscores(cps);
	//enforce_runs(cps, UNDERSCORE, 2);
	//enforce_runs(cps, HYPHEN, 2);
	if (is_basic(cps)) return 'Basic';
	return '';
}

function is_basic(cps) {
	/*
	for (let cp of cps) {
		if (cp == EMOJI) continue; 
		if (cp == HYPHEN) continue;
		if (cp == UNDERSCORE) continue;
		if (cp >= 48 && cp <= 57) continue; // 0-9
		if (cp >= 97 && cp <= 122) continue; // a-z
		return false;
	}
	return true;
	*/
	return cps.every(cp => (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57) || cp === EMOJI || cp === HYPHEN || cp == UNDERSCORE);
}

export function ens_validate(name) {
	let labels = [[]];
	for (let token of ens_tokenize(name)) {
		switch (token.type) {
			case 'stop': {
				labels.push([]);
				continue;
			}
			case 'emoji':
			case 'valid': {
				labels[labels.length - 1].push(token);
				continue;
			}
			//case 'disallowed':
			//case 'ignored':
			//case 'mapped': 
			//case 'nfc': 
			default: throw new Error('not normalized');
		}
	}
	ens_normalize_post_check(name);
	return labels.map(tokens => {
		let cps0 = tokens.flatMap(token => token.cps);
		let cps =  tokens.flatMap(token => token.type === 'emoji' ? EMOJI : token.cps.map(cp => is_safe_text_emoji(cp) ? EMOJI : cp));
		let ret = {
			label: String.fromCodePoint(...cps0), 
			cps: cps0,
			emoji: cps.includes(EMOJI)
		};
		try {
			ret.grade = validate_label(cps0, cps);
		} catch (err) {
			ret.error = err;
		}
		return ret;
	});
}

console.log(ens_validate('_💩ra--ff--y.eth'));