// compute script order (requires functioning normalization)
// 1. npm run rebuild
// 2. node tools/group-order.js js			// produces output for rules
// 3. update derive/rules/group-order.js
// 4. npm run rebuild						// run again to bake ordering into spec

import {read_labels, compute_spec_hash} from '../validate/data.js';
import {ens_split} from '../src/lib.js';

let tally = new Map();
for (let label of read_labels()) {
	let labels = ens_split(label);
	if (labels.length != 1) throw new Error('wtf');
	let group = labels[0].script || '*Error';
	let counter = tally.get(group);
	if (!counter) {
		counter = {group, count: 0};
		tally.set(group, counter);
	}
	counter.count++;
}

let sorted = [...tally.values()].sort((a, b) => b.count - a.count);

let args = process.argv.slice(2);
if (args[0] === 'js') {
	console.log(`// Computed: ${new Date().toJSON()}`);
	console.log(`// Spec: ${compute_spec_hash()}`);
	console.log('[');
	for (let {group, count} of sorted) {
		console.log(`\t'${group}', // ${count}`);
	}
	console.log(']');
} else {
	let total = sorted.reduce((a, g) => a + g.count, 0);
	let width = 8;
	for (let {group, count} of sorted) {
		console.log(String(count).padStart(width), (count / total * 100).toFixed(4).padStart(width) + '%', group);
	}
}
