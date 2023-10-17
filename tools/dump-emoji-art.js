import {writeFileSync} from 'node:fs';
import {read_labels} from '../validate/data.js';
import {ens_emoji, ens_normalize, ens_tokenize} from '../src/lib.js';

let found = [];

for (let label of read_labels()) {
	if (label.includes('.')) continue;	
	if (parse_art(label)) {
		found.push(label);
	}
}

writeFileSync(new URL('./output/art.json', import.meta.url), JSON.stringify(found, null, '\t'));

function is_hyphen_token(t) {
	return t.type === 'valid' && t.cps.length === 1 && t.cps[0] === 0x2D;
}

function is_normalized_label(s) {
	try {
		return ens_normalize(label) === label;
	} catch (err) {		
	}
}

function is_disallowed_emoji(t) {
	if (t.type === 'disallowed') {
		if (t.cp >= 0x1F3FB && t.cp <= 0x1F3FF) return true; // tone
		if (t.cp >= 0x1F1E6 && t.cp <= 0x1F1FF) return true; // regional
		switch (t.cp) { 
			case 0x1F202: // maybe
			case 0x1F21A:
			case 0x1F22F:
			case 0x1F232:
			case 0x1F233:
			case 0x1F234:
			case 0x1F235:
			case 0x1F236:
			case 0x1F237: // maybe
			case 0x1F238:
			case 0x1F239:
			case 0x1F23A:
			case 0x1F250:
			case 0x1F251: return true; // japanese buttons
		}
	}
}

function parse_art(label) {
	//if (!is_normalized_label(label)) return;
	let tokens = ens_tokenize(label);
	if (tokens.length < 36) return;



	if (tokens.every(t => t.emoji || is_disallowed_emoji(t) || is_hyphen_token(t))) {
		return true;
	}
	if (label.endsWith('ensart')) {
		return true;
	}
}

	/*
function is_emoji_art(tokens) {
	let pos = [];
	tokens.forEach((t, i) => {
		if (!t.emoji && t.cps.length === 1 && t.cps[0] === HYPHEN) {
			pos.push(i);
		}
	});
	if (pos.length >= MIN && pos[0] >= MIN && pos.every((x, i) => x === i+pos[0]*(i+1))) {
		let values = tokens.filter(t => t.emoji).map(t => t.emoji);
		return {width: pos[0], values};
	}
	const ENSART = 14;
	if (tokens.length >= MIN*ENSART && reg.label.endsWith('ensart')) {
		return {width: ENSART, values: tokens.slice(0, -1).map(t => t.emoji)};
	}
	let flat = tokens.flatMap(t => t.emoji ? [t.emoji] : t.cps.map(cp => [cp]));
	let size = Math.sqrt(flat.length);
	if (size * size === flat.length) {
		return {width: size, values: flat};
	}
}
*/