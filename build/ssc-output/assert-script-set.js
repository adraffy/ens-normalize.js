
import {map_values} from '../utils.js';
import {read_script_sets} from '../unicode-logic.js';

let {ALL, ...scripts} = map_values(read_script_sets(), cps => new Set(cps)); 

function resolve_scripts(cps) {
	let ret = Object.keys(scripts);
	for (let cp of cps) {
		if (ALL.has(cp)) continue;
		ret = ret.filter(k => scripts[k].has(cp));
		if (ret.length == 0) break;		
	}
	return ret;
}

function assert_resolved(cps, u) {
	let v = resolve_scripts(cps);
	if (v.length != u.length || !v.every(x => u.includes(x)) && !u.every(x => v.includes(x))) {
		throw new Error('wtf');
	}
}

// https://www.unicode.org/reports/tr39/#def-single-script
assert_resolved([0x0043, 0x0069, 0x0072, 0x0063, 0x006C, 0x0065], ['Latn']);
assert_resolved([0x0421, 0x0456, 0x0433, 0x0441, 0x04C0, 0x0435], ['Cyrl']);
assert_resolved([0x0421, 0x0069, 0x0072, 0x0441, 0x006C, 0x0435], []);
assert_resolved([0x0043, 0x0069, 0x0072, 0x0063, 0x0031, 0x0065], ['Latn']);
assert_resolved([0x0043, 0x1D5C2, 0x1D5CB, 0x1D5BC, 0x1D5C5, 0x1D5BE], ['Latn']);
assert_resolved([0x1D5A2, 0x1D5C2, 0x1D5CB, 0x1D5BC, 0x1D5C5, 0x1D5BE], Object.keys(scripts));
assert_resolved([0x3006, 0x5207], ['Hani', 'Hanb', 'Jpan', 'Kore']);
assert_resolved([0x306D, 0x30AC], ['Jpan']);