import {nfc} from '../build/nf.js';
import {compare_arrays, explode_cp, split_between} from '../build/utils.js';
import {read_parsed} from '../build/nodejs-utils.js';
import {read_combining_marks} from '../build/unicode-logic.js';

let cm = read_combining_marks();

for (let args of Object.values(read_parsed('NormalizationTest')).flat()) {
	let [src, nfc0, nfd0] = args.map(explode_cp);
	let base = nfd0;
	let m = split_between(base, (a, b) => cm.has(a) && !cm.has(b));
	let nfc1 = m.map(nfc).flat();
	if (compare_arrays(nfc0, nfc1)) {
		console.log(base.map(cp => [cp, cm.has(cp)]));
		console.log(m);
		console.log(nfc0);
		console.log(nfc1);
		process.exit(1);
	}
}

// if we got here, then nfc preserves global order
// and can be decomposed at [a,cm,cm,b,cm,cm] => [[a,cm,cm],[b,cm,cm]]