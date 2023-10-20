import {read_labels} from './data.js';
import {ensNormalize} from '../src/lib.js';

const LABELS = read_labels();

let t = performance.now();
for (let label of LABELS) {
	try {
		ensNormalize(label);
	} catch (err) {
	}
}
t = performance.now() - t;

console.log(`${((t * 1000) / LABELS.length).toFixed(1)} μs/label`);

// 20221125: 5.6 μs/label
// 20230111: 4.9 μs/label
// 20230920: 3.8 μs/label
