// distribution of error types in labels

import {read_labels} from './data.js';
import {ens_normalize} from '../src/lib.js';

const LABELS = read_labels();

let tally = {};
for (let label of LABELS) {
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
let total = tally.reduce((a, x) => a + x.count, 0);

let perc = 6;
let count_pad = total.toString().length;
console.log(new Date().toJSON());
for (let {count, error} of tally) {
	console.log(
		(100 * count / LABELS.length).toFixed(perc).padStart(perc+4)+'%',
		count.toString().padStart(count_pad), 
		error
	);
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

/*
Loaded 2479142 labels in 2.1s
2023-02-12T04:23:02.645Z
  0.618480% 15333 disallowed character
  0.359358%  8909 diff norm
  0.052155%  1293 illegal mixture
  0.038481%   954 underscore allowed only at start
  0.015933%   395 whole-script confusable
  0.008188%   203 invalid label extension
  0.006535%   162 illegal placement
  0.001573%    39 too many combining marks
  0.000081%     2 empty label
*/