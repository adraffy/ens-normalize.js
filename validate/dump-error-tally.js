import {read_labels} from './data.js';
import {ens_normalize} from '../src/lib.js';

let labels = read_labels();

let tally = {};
for (let label of labels) {
	try {
		let norm = ens_normalize(label);
		if (norm != label) {
			throw new Error('diff norm');
		}
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

console.log(new Date().toJSON());
for (let {count, error} of tally) {
	console.log(String(count).padStart(7), error);
}

/*
Loaded 2350342 labels in 2.0s
2022-11-27T07:33:22.604Z
  14198 disallowed character
   8844 diff norm
   1263 illegal mixture
    946 underscore allowed only at start
    376 whole-script confusable
    203 invalid label extension
    162 illegal placement
     38 too many combining marks
*/