// compare two unicode versions AFTER parsing
// TODO: support arg1 arg2 where arg = unicode-version/cldr-version

import {UnicodeSpec} from './unicode-logic.js';
import {ens_idna_rules} from './idna.js'; 

const UNICODE0 = UnicodeSpec.from_release('current');
const UNICODE1 = UnicodeSpec.from_release('beta');

deep_diff(expand(UNICODE0), expand(UNICODE1), (path, a, b) => {
	console.log(`[${path.join('/')}] ${a} =!= ${b}`);
});

function expand(unicode) {
	let obj = {
		unicode, 
		idna_ens: expand_idna(ens_idna_rules(unicode)),
		//idna_2003: unicode.derive_idna_rules({version: 2003, use_STD3: true, valid_deviations: true}),
		emoji_data: map_values(unicode.read_emoji_data(), v => new Map(v.map(x => [x.cp, x]))),
		emoji_zwjs: expand_named_cps(unicode.read_emoji_zwjs()),
		emoji_seqs: expand_named_cps(unicode.read_emoji_seqs()),
		regions: new Set(unicode.read_regions()),
	};
	for (let fn of [
		// [UnicodeSpec]
		//'read_ucd', 
		//'read_scripts',
		//'read_short_names', 
		//'read_prop_values',
		//'read_script_extensions',

		//'derive_idna_rules'
		//'read_emoji_zwjs',
		//'read_emoji_seqs',
		//'read_emoji_data',
		//'read_props',
		//'read_regions',

		'get_noncharacter_cps', 
		'combining_ranks',
		'decompositions',
		'read_confusables',
		'read_intentional_confusables',
		'read_script_kinds',

		// [ignored]
		//'get_unnamed_cps',
		//'read_emoji_test',
		//'read_nf_tests',
		//'core_props',
		//'read_allowed_identifiers',
		//'read_identifier_types',
		//'read_nf_props',
	]) {
		obj[fn] = unicode[fn]();
	}
	return obj;
}
function expand_named_cps(m) {
	return map_values(m, v => new Map(v.map(x => [String.fromCodePoint(...x.cps), x])));
}
function expand_idna({valid, mapped, ignored}) {
	return {
		valid: new Set(valid),
		mapped: new Map(mapped),
		ignored: new Set(ignored)
	};
}
function map_values(obj, fn) {
	for (let [k, v] of Object.entries(obj)) {
		obj[k] = fn(v, k);
	}
}

function deep_diff(a, b, callback, path = [], visited = new Set()) {
	if (a === b) return; // trivial
	if (typeof a !== typeof b || is_primitive(a) || is_primitive(b)) { // not same type or not same primitive value
		return callback(path, a, b); 
	}
	if (a.constructor !== b.constructor) { // not same constructor
		return callback(path, a, b);
	}
	if (a.toJSON) { // use serialized form
		return deep_diff(a.toJSON(), b.toJSON(), callback, [...path, 'toJSON()'], visited);
	}
	if (visited.has(a)) return; // prevent cycles
	visited.add(a);
	if (a instanceof Map) {
		for (let k of new Set([...a.keys(), ...b.keys()])) {
			deep_diff(a.get(k), b.get(k), callback, [...path, k], visited);
		}
	} else if (a instanceof Set) {
		if ([...a, ...b].every(is_primitive)) {
			let a_minus_b = new Set([...a].filter(x => !b.has(x)));
			let b_minus_a = new Set([...b].filter(x => !a.has(x)));
			if (a_minus_b.size || b_minus_a.size) {
				callback([...path, 'symmetricDiff()'], [...a_minus_b], [...b_minus_a]);
			}
		} else {
			for (let k of new Set([...a, ...b])) {
				deep_diff(a.has(k), b.has(k), callback, [...path, k], visited);
			}
		}
	} else if (Array.isArray(a)) {
		let size = Math.max(a.length, b.length);
		if (size <= 10 && [...a, ...b].every(is_primitive)) { // treat small array as literal
			return deep_diff(JSON.stringify(a), JSON.stringify(b), callback, [...path, 'stringify()'], visited);
		}
		for (let i = 0; i < size; i++) {
			deep_diff(a[i], b[i], callback, [...path, `[${i}]`], visited);
		}
	} else {
		for (let k of new Set([...Object.keys(a), ...Object.keys(b)])) {
			deep_diff(a[k], b[k], callback, [...path, k], visited);
		}
	}
}
function is_primitive(x) {
	switch (typeof x) {
		case 'function':
		case 'object': return false;
		default: return true;
	}
}
