import {read_labels} from './data.js';
import {ens_split} from '../src/lib.js';

let labels = read_labels();

let tally = {};
for (let label of labels) {
	let split = ens_split(label);
	if (split.length != 1) throw new Error('wtf');
	split = split[0];
	let type;
	if (split.error) {
		type = '*** Error';
	} else {
		type = split.type;
		if (type !== 'Emoji' && split.emoji) {
			type += '+Emoji';
		}
	}
	let rec = tally[type];
	if (!rec) tally[type] = rec = {type, count: 0};
	rec.count++;
}
tally = Object.values(tally).sort((a, b) => b.count - a.count);
let total = tally.reduce((a, x) => a + x.count, 0);

console.log(new Date().toJSON());
for (let {count, type} of tally) {
	console.log(
		(100 * count / total).toFixed(4).padStart(7)+'%', 
		String(count).padStart(7), 
		type
	);
}
