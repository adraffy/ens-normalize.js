
import {map_values, explode_cp} from '../utils.js';
import {read_script_sets} from '../unicode-logic.js';
import {nfc} from '../nf.js';

console.log(nfc([0x2F824]));

/*
let {ALL, ...scripts} = map_values(read_script_sets(3), cps => new Set(cps)); 

function resolve_scripts(cps) {
	let ret = Object.keys(scripts);
	for (let cp of cps) {
		if (ALL.has(cp)) continue;
		ret = ret.filter(k => scripts[k].has(cp));
		if (ret.length == 0) break;		
	}
	return ret;
}

console.log(resolve_scripts(explode_cp('1a〆')));

console.log(resolve_scripts(explode_cp('万丟')));

console.log(resolve_scripts(explode_cp('$£¥€₿')));
*/