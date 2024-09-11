// compare two unicode versions AFTER parsing
// TODO: expand more of this into hex literals

// `node unicode-diff.js`     => current vs beta
// `node unicode-diff.js r`   => current vs $r
// `node unicode-diff.js a b` =>      $a vs $b 

import {UnicodeChar, UnicodeScript, UnicodeSpec} from './unicode-logic.js';
import {ens_idna_rules} from './idna.js'; 
import {hex_cp} from './utils.js';

function hex_cps(cps) {
	return cps.map(hex_cp).join(' ');
}

let args = process.argv.slice(2);
if (args.length < 2) args.unshift('current');
if (args.length < 2) args.push('beta');
const UNICODE0 = UnicodeSpec.from_release(args[0]);
const UNICODE1 = UnicodeSpec.from_release(args[1]);

deep_diff(expand(UNICODE0), expand(UNICODE1), (path, a, b) => {
	console.log(`[${path.join('/')}] ${stringify(a)} =!= ${stringify(b)}`);
});

function expand(unicode) {
	let {valid, mapped, ignored} = ens_idna_rules(unicode);
	return {
		...unicode,
		idna_ens: {
			valid: new Set(valid.map(hex_cp)),
			mapped: new Map(mapped.map(([k, v]) => [hex_cp(k), hex_cps(v)])),
			ignored: new Set(ignored.map(hex_cp))
		},
		//idna_2003: unicode.derive_idna_rules({version: 2003, use_STD3: true, valid_deviations: true}),
		//emoji_data: map_values(unicode.read_emoji_data(), v => new Map(v.map(x => [hex_cp(x.cp), hex_seq(x)]))),
		emoji_data: new Map(Object.entries(unicode.read_emoji_data()).map(([k, v]) => [k, new Set(v.map(x => hex_cp(x.cp)))])),
		emoji_zwjs: new Map(Object.entries(unicode.read_emoji_zwjs()).map(([k, v]) => [k, new Set(v.map(x => hex_cps(x.cps)))])),
		emoji_seqs: new Map(Object.entries(unicode.read_emoji_seqs()).map(([k, v]) => [k, new Set(v.map(x => hex_cps(x.cps)))])),
		regions: new Set(unicode.read_regions()),
		combining_class: new Map(unicode.combining_classes().map(([k, v]) => [k, new Set(v.map(hex_cp))])),
		decompositions: new Map(unicode.decompositions().map(([k, v]) => [k, hex_cps(v)])),
		confusables: new Map(unicode.read_confusables().map(([k, v]) => [hex_cps(k), new Set(v.map(hex_cp))])),
		intentional_confusables: new Map(unicode.read_intentional_confusables()),
		nonchars: new Set(unicode.get_noncharacter_cps().map(hex_cp)),
		script_kinds: new Map(Object.entries(unicode.read_script_kinds()).map(([k, v]) => [k, new Set(v)])),
	};
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
				callback([...path, 'diff()'], [...a_minus_b], [...b_minus_a]);
			}
		} else {
			for (let k of new Set([...a, ...b])) {
				deep_diff(a.has(k), b.has(k), callback, [...path, k], visited);
			}
		}
	} else if (Array.isArray(a)) {
		let size = Math.max(a.length, b.length);
		if (size <= 10 && [...a, ...b].every(is_primitive)) { // treat small array as literal
			return deep_diff(stringify(a), stringify(b), callback, [...path, 'stringify()'], visited);
		}
		for (let i = 0; i < size; i++) {
			deep_diff(a[i], b[i], callback, [...path, `[${i}]`], visited);
		}
	} else {
		for (let k of new Set([...get_keys(a), ...get_keys(b)])) {
			deep_diff(a[k], b[k], callback, [...path, k], visited);
		}
	}
}

function get_keys(x) {
	let keys = Object.keys(x);
	if (x instanceof UnicodeChar) {
		keys = keys.filter(x => x !== 'extended')
	}
	return keys;
}

function stringify(x) {
	if (x instanceof Set) {
		return stringify([...x]);
	} else if (x instanceof Map) {
		return stringify(Object.fromEntries([...x]));
	} else if (x === undefined) {
		return '?';
	} else if (is_custom_object(x)) {
		return `${x}`;
	} else {
		if (Array.isArray(x) && x.every(y => y instanceof UnicodeScript)) {
			x = x.map(y => y.abbr);
		}
		return JSON.stringify(x);
	}
}

// function is_literal_object(x) {
// 	return x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype;
// }

// not an array or literal object
function is_custom_object(x) { 
	return x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype;
}

function is_primitive(x) {
	switch (typeof x) {
		case 'function':
		case 'object': return false;
		default: return true;
	}
}
