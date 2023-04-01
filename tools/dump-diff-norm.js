
import {read_labels} from '../validate/data.js';
import {ens_normalize} from '../src/lib.js';
import eth_ens_namehash from '../test/eth-ens-namehash@2.0.15.min.js';

// given: name
// a = ens-normalize(name) 
// b = eth-ens-namehash(name)
// assume: Diff Norm = true (a != b)
let case1 = 0; // a == name
let case2 = 0; // b == name
let case3 = 0; // a != name && b != name

for (let label of read_labels()) {
	try {
		let a = ens_normalize(label);
		let b = eth_ens_namehash.normalize(label);
		if (a === b) continue;
		if (a === label) {
			case1++;
		} else if (b === label) {
			case2++;
		} else { // (a !== label && b !== label) 
			case3++;
		}
	} catch (err) {
	}
}
console.log({case1, case2, case3});

// 20230331:
// { case1: 0, case2: 3383, case3: 1 }
