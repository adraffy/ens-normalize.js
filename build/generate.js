import {ens_normalize} from './lib-normalize.js';
import {parse_cp_range, map_values, quote_cp, random_choice} from './utils.js';
import {read_parsed} from './nodejs-utils.js';

export function generate_contextj_zwnj_rule2() {
	let {T, L, R, D} = map_values(read_parsed('DerivedJoiningType'), x => x.flatMap(parse_cp_range));
	let LD = [...new Set([...L, ...D])];
	let RD = [...new Set([...R, ...D])];
	return () => {
		while (true) {
			try {
				let cps = [
					random_choice(LD),
					random_choice(T),
					0x200C,
					random_choice(T),
					random_choice(RD)
				];
				let name = String.fromCodePoint(...cps);
				ens_normalize(name);
				return cps; 
			} catch (err) {
			}
		}
	};
}

console.log(generate_contextj_zwnj_rule2()().map(quote_cp).join(''));