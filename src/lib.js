import r from './include.js';
import {read_member_array, read_mapped_map, read_emoji_trie} from './decoder.js';

const VALID = new Set(read_member_array(r));
const IGNORED = new Set(read_member_array(r));
const MAPPED = read_mapped_map(r);
const EMOJI_ROOT = read_emoji_trie(r);
const NFC_CHECK = new Set(read_member_array(r, [...VALID].sort((a, b) => a - b)));

function nfc(s) {
	return s.normalize('NFC');
}

function explode_cp(s) {
	return [...s].map(x => x.codePointAt(0));
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != 0xFE0F);
}

export function ens_normalize(name, beautify = false) {
	let input = [...name].map(x => x.codePointAt(0)).reverse(); // flip for pop
	let output = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, EMOJI_ROOT);
		if (emoji) {
			output.push(...(beautify ? emoji.emoji : filter_fe0f(emoji.input)));
			continue;
		}
		let cp = input.pop();
		if (VALID.has(cp)) {
			output.push(cp);
			continue;
		} 
		if (IGNORED.has(cp)) {
			continue;
		}
		let cps = MAPPED[cp];
		if (cps) {
			output.push(...cps);
			continue;
		}
		throw new Error(`Disallowed codepoint: 0x${cp.toString(16).toUpperCase()}`);
	}
	return nfc(String.fromCodePoint(...output));
}

const TY_VALID = 'valid';
const TY_MAPPED = 'mapped';
const TY_IGNORED = 'ignored';

export function ens_tokenize(name) {
	let input = explode_cp(name).reverse();
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, EMOJI_ROOT);
		if (emoji) {
			tokens.push({type: 'emoji', ...emoji, cps: filter_fe0f(emoji.input)});
		} else {
			let cp = input.pop();
			if (cp === 0x2E) {
				tokens.push({type: 'stop'});
			} else if (VALID.has(cp)) {
				tokens.push({type: TY_VALID, cps: [cp]});
			} else if (IGNORED.has(cp)) {
				tokens.push({type: TY_IGNORED, cp})
			} else {
				let cps = MAPPED[cp];
				if (cps) {
					tokens.push({type: TY_MAPPED, cp, cps});
				} else {
					tokens.push({type: 'disallowed', cp});
				}
			}
		}
	}
	for (let i = 0, last = 0; i < tokens.length; i++) {
		if (nfc_check_token(tokens[i])) {
			let end = i + 1;
			while (end < tokens.length && nfc_check_token(tokens[end], true)) end++;
			let slice = tokens.slice(last, end);
			let cps = slice.flatMap(x => x.cps ?? []);
			let str0 = String.fromCodePoint(...cps);
			let str = nfc(str0);
			if (str0 === str) {
				last = end;
				i = end - 1; // skip
			} else {
				tokens.splice(last, end - last, {type: 'nfc', input: cps, cps: explode_cp(str), tokens: collapse_valid_tokens(slice)});
				i = last++;
			}
		} else {
			switch (tokens[i].type) {
				case TY_VALID: 
				case TY_MAPPED: last = i; break;
			}
		}
	}
	return collapse_valid_tokens(tokens);
}

function nfc_check_token(token, ignored) {
	switch (token.type) {
		case TY_VALID:
		case TY_MAPPED: return token.cps.some(cp => NFC_CHECK.has(cp));
		case TY_IGNORED: return ignored;
	}
}

// collapse adjacent valid tokens
function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type === TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type === TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

function consume_emoji_reversed(cps, node) {
	let emoji;
	let fe0f;
	let stack = [];
	let input = [];
	let pos = cps.length;
	while (pos) {
		let cp = cps[--pos];
		if (cp === 0xFE0F) {
			if (!fe0f) break; // we didn't expect FE0F
			fe0f = false; // clear flag
			continue;
		}
		node = node.branches.find(x => x.set.has(cp))?.node;
		if (!node) break;
		stack.push(cp);
		fe0f = node.fe0f;
		if (fe0f) stack.push(0xFE0F);
		if (node.valid) { // this is a valid emoji (so far)
			if (fe0f && pos > 0 && cps[pos - 1] == 0xFE0F) { // eat FE0F too
				fe0f = false;
				pos--;
			}
			emoji = stack.slice(); // copy stack
			input.push(...cps.slice(pos).reverse()); // copy input
			cps.length = pos; // truncate
		}
	}
	if (emoji) return {input, emoji};
}