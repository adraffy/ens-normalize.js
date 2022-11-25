import {read_labels} from './data.js';
import {ens_normalize} from '../src/lib.js';

let labels = read_labels();

let tally = {};
for (let label of labels) {
	try {
		ens_normalize(label);
	} catch (err) {
		let error = err.message;
		let i = error.indexOf(':');
		if (i >= 0) error = error.slice(0, i).trim();
		let rec = tally[error];
		if (!rec) tally[error] = rec = {error, count: 0};
		rec.count++;
	}
}
tally = Object.values(tally).sort((a, b) => b.count - a.count);

for (let {count, error} of tally) {
	console.log(String(count).padStart(7), error);
}