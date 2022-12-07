// code that is not included in the library 
// but might be useful

import {ens_normalize, ens_split, ens_tokenize} from '../src/lib.js';

function expect_fail(fn) {
	try {
		fn();
	} catch (err) {
		console.log(`Expected failure: ${err}`);
		return;
	}
	throw new Error('expected failure');
}

// ********************************************************************************
// is the string normalized?
// returns true if normalized,
// false transform required,
// or undefined if not normalizable
function is_normalized(name) {
	try {
		return ens_normalize(name) === name;
	} catch (err) {		
	}
}

console.log(is_normalized);
console.log(is_normalized('A')); // false
console.log(is_normalized('a')); // true

// ********************************************************************************
// is the name ascii?
function is_ascii_name(name) {
	return ens_split(name).every(label => label.type === 'ASCII');
}

console.log(is_ascii_name);
console.log(is_ascii_name("x's")); // false
console.log(is_ascii_name('xs')); // true

// ********************************************************************************
// is the string a emoji?
// returns true if one emoji glyph
function is_emoji(one_emoji) {
	let tokens = ens_tokenize(one_emoji);
	return tokens.length == 1 && tokens[0].type === 'emoji';
}

console.log(is_emoji);
console.log(is_emoji('a')); // false
console.log(is_emoji('💩')); // true

// ********************************************************************************
// number of repeated sequences to hit minimum length of 3
function get_min_length(ncp, len = 3) {
	return 1 + Math.max(0, len - ncp);
}

console.log(get_min_length(1)); // 3
console.log(get_min_length(2)); // 2
console.log(get_min_length(5)); // 1

// ********************************************************************************
// make emoji minimal repeated
// returns minimial normalized emoji string or throws
function get_min_repeated(one_emoji) {
	let tokens = ens_tokenize(one_emoji);
	if (tokens.length != 1 || tokens[0].type !== 'emoji') throw new TypeError('expected emoji');
	let {cps} = tokens[0];
	return String.fromCodePoint(...cps).repeat(get_min_length(cps.length));
}

expect_fail(() => get_min_repeated('abc')); // not emoji
console.log(get_min_repeated('💩')); // "💩💩💩"
console.log(get_min_repeated('🇺🇸')); // "🇺🇸🇺🇸"
console.log(get_min_repeated('👩🏽‍⚕️')); // "👩🏽‍⚕️"

// ********************************************************************************
// is "pure" ethmoji?
// emoji-only 2LD, repeated, minimal, optional ".eth"
// doesn't need to be normalized, but must normalize
// returns [repeated count, beautifed single emoji] or throws
function get_pure(name) {
	let norm = ens_normalize(name);
	if (norm.endsWith('.eth')) norm = norm.slice(0, -4);
	if (norm.includes('.')) throw new Error('not 2LD');
	let tokens = ens_tokenize(norm);
	if (!tokens.every(t => t.emoji)) throw new TypeError('not ethmoji');
	let {cps} = tokens[0];
	for (let i = 1; i < tokens.length; i++) {
		if (tokens[i].cps.some((cp, j) => cp !== cps[j])) {
			throw new TypeError('not repeated');
		}
	}
	if (tokens.length != get_min_length(cps.length)) {
		throw new TypeError('not minimal');
	}
	return [tokens.length, String.fromCodePoint(...tokens[0].emoji)];
}

expect_fail(() => get_pure('abc💩'));// TypeError('not ethmoji')
expect_fail(() => get_pure('a.b.c')); // TypeError('not 2LD')
expect_fail(() => get_pure('💩💩💩💩')); // TypeError('not minimial')
console.log(get_pure('💩💩💩.Eth')); // [3, "💩"]
console.log(get_pure('🇺🇸🇺🇸.ETH')); // [2, "🇺🇸"]
console.log(get_pure('👩🏽‍⚕️')); // [1, '👩🏽‍⚕️']
