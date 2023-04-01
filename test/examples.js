// code that is not included in the library 
// but might be useful

import {ens_normalize, ens_split, ens_tokenize} from '../src/lib.js';
import {explode_cp, str_from_cps} from '../src/utils.js';

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
// is the string a single emoji?
// returns true if one emoji glyph
function is_emoji(one_emoji) {
	let tokens = ens_tokenize(one_emoji);
	return tokens.length == 1 && !!tokens[0].emoji; // or .type === 'emoji';
}

console.log(is_emoji);
console.log(is_emoji('a')); // false
console.log(is_emoji('💩')); // true

// ********************************************************************************
// number of repeated sequences to hit minimum length of 3
function get_min_length(ncp, len = 3) {
	return 1 + Math.max(0, len - ncp);
}

console.log(get_min_length);
console.log(get_min_length(1)); // 3
console.log(get_min_length(2)); // 2
console.log(get_min_length(5)); // 1

// ********************************************************************************
// make emoji minimal repeated
// returns minimial normalized emoji string or throws
function get_min_repeated(one_emoji) {
	if (!is_emoji(one_emoji)) throw new TypeError('expected emoji');
	let [{cps}] = ens_tokenize(one_emoji);
	return String.fromCodePoint(...cps).repeat(get_min_length(cps.length));
}

console.log(get_min_repeated);
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

console.log(get_pure);
expect_fail(() => get_pure('abc💩'));// TypeError('not ethmoji')
expect_fail(() => get_pure('a.b.c')); // TypeError('not 2LD')
expect_fail(() => get_pure('💩💩💩💩')); // TypeError('not minimial')
console.log(get_pure('💩💩💩.Eth')); // [3, "💩"]
console.log(get_pure('🇺🇸🇺🇸.ETH')); // [2, "🇺🇸"]
console.log(get_pure('👩🏽‍⚕️')); // [1, '👩🏽‍⚕️']

// ********************************************************************************
// is valid?
// returns true of the codepoint is "potentially" valid
function is_valid(cp) {
	return ens_tokenize(String.fromCodePoint(cp))[0].type === 'valid';
}

console.log(is_valid);
console.log(is_valid(0x61));
console.log(is_valid(0x20));

// ********************************************************************************
// get mapped
// returns mapped characters for the codepoint 
// or null if not mapped
function get_mapped(cp) {
	let [token] = ens_tokenize(String.fromCodePoint(cp));
	return token.type === 'mapped' ? token.cps : null;
}

console.log(get_mapped);
console.log(get_mapped(0x2167)); // Ⅷ -> [v, i, i, i]
console.log(get_mapped(0x41)); // A -> [a]
console.log(get_mapped(0x61)); // a -> null

// ********************************************************************************
// replace disallowed characters with their likely-intended equivalent
// note: this is unsafe for general use, but a nice convenience for single-name input fields
function replace_sloppy(s) {
	const MAP = new Map([
		[0x2F, 0x2044], // 2F (/) SOLIDUS => 2044 (⁄) FRACTION SLASH
		[0x3002, 0x2E], // 3002 (。) IDEOGRAPHIC FULL STOP => 2E (.) FULL STOP
		[0xFF0E, 0x2E], // FF0E (．) FULLWIDTH FULL STOP => 2E (.) FULL STOP
		[0xFF61, 0x2E], // FF61 (｡) HALFWIDTH IDEOGRAPHIC FULL STOP => 2E (.) FULL STOP
	]);
	return str_from_cps(explode_cp(s).map(x => MAP.get(x) ?? x));
	// alternative:
	//return s.replaceAll('/', '\u2044').replace(/(\u3002|\uFF0E|\uFF61)/gu, '.');
}

console.log(replace_sloppy);
console.log(replace_sloppy("1/4.eth")); // "1/4.eth" -> "1⁄4.eth"

// ********************************************************************************
// make a best case attempt at normalizing a name
// note: this is unsafe for general use
function force_normalize(s) {
	return str_from_cps(ens_tokenize(s).flatMap(token => {
		switch (token.type) { 
			case 'ignored': return []; // removes ignored (dangerous)
			case 'mapped': // applies known mappings 
			case 'emoji': // removes FE0F from known emoji
			case 'nfc':
			case 'valid': return token.cps;
			default: return token.cp;
		}
	}));
}

console.log(force_normalize);
console.log(force_normalize('A_B_C')); // "a_b_c"

// ********************************************************************************
// collapse null labels
// leaves the rest of the string unchanged
// note: this correctly collapses ".{ignored}."
function collapse_null_labels(s) {
	return ens_split(s).filter(x => !x.tokens || x.tokens.length).map(x => str_from_cps(x.input)).join('.');
}

console.log(collapse_null_labels);
console.log(collapse_null_labels('...a...eth...')); // "a.eth"
console.log(collapse_null_labels('1.\uFE0F..eth')); // "1.eth"
console.log(collapse_null_labels('....!...eth..')); // "!.eth"

// ********************************************************************************
// filter emoji (optional FE0F)
// tokenize, filter emoji, reassemble
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

console.log(filter_emoji);
console.log(filter_emoji('\u{1F4A9}') == ''); // true
console.log(filter_emoji('\u{1F4A9}\uFE0F') == ''); // true
console.log(filter_emoji('\u{1F4A9}\uFE0F\uFE0F') == '\uFE0F'); // true
