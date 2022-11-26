import {read_labels} from './data.js';
import {ens_normalize} from '../src/lib.js';

let labels = read_labels();

let t = performance.now();
for (let label of labels) {
	try {
		ens_normalize(label);
	} catch (err) {
	}
}
t = performance.now() - t;

console.log(`${((t * 1000) / labels.length).toFixed(1)} μs/label`);

// 20221125: 5.6 μs/label