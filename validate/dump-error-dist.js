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

let perc = 4;
let count_pad = total.toString().length;
console.log(new Date().toJSON());
for (let {count, error} of tally) {
	console.log(
		(100 * count / LABELS.length).toFixed(perc).padStart(perc+4)+'%', // perc of all names
		(100 * count / total).toFixed(perc).padStart(perc+4)+'%', 
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
Loaded 2479142 labels in 2.2s
2023-02-12T23:59:21.302Z
  0.6185%  56.1854% 15333 disallowed character
  0.3594%  32.6457%  8909 diff norm
  0.0522%   4.7380%  1293 illegal mixture
  0.0385%   3.4958%   954 underscore allowed only at start
  0.0159%   1.4474%   395 whole-script confusable
  0.0082%   0.7439%   203 invalid label extension
  0.0065%   0.5936%   162 illegal placement
  0.0016%   0.1429%    39 too many combining marks
  0.0001%   0.0073%     2 empty label
*/