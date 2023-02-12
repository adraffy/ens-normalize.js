// compute script order (requires functioning normalization)
// 1. npm run rebuild
// 3. node validate/dump-group-order.js save
// 4. npm run rebuild (run again to bake ordering into spec)

import {writeFileSync} from 'node:fs';
import {read_labels} from '../validate/data.js';
import {ens_split} from '../src/lib.js';
import {spec_hash} from '../src/include-versions.js';

let labels = read_labels();

let tally = new Map();
for (let label of labels) {
	let labels = ens_split(label);
	if (labels.length != 1) throw new Error('wtf');
	let group = labels[0].type || '*** Error';
	let counter = tally.get(group);
	if (!counter) {
		let restricted = group.startsWith('Restricted['); // meh
		if (restricted) group = group.slice(-5, -1);
		counter = {group, restricted, count: 0};
		tally.set(group, counter);
	}
	counter.count++;
}

let sorted = [...tally.values()].sort((a, b) => b.count - a.count);
let count_len = sorted.reduce((a, g) => Math.max(a, String(g.count).length), 0);
let group_len = sorted.reduce((a, g) => Math.max(a, g.group.length), 0);

function perc(n) {
	return `${(n / labels.length * 100).toFixed(5)}%`.padStart(10); // 100.00000%
}

const RESTRICTED = '[Restricted]';

let args = process.argv.slice(2);
if (args[0] === 'save') {	
	writeFileSync(new URL('../derive/rules/group-order.js', import.meta.url), [
		`// Computed: ${new Date().toJSON()}`,
		`// Spec: ${spec_hash}`,
		`// Total: ${labels.length}`,
		'export default [',
		...sorted.map(({group, count, restricted}) => {
			let index = group.indexOf('[');
			if (index >= 0) group = group.slice(index+1, -1);
			let extra = `${String(count).padStart(count_len)} | ${perc(count)}`;
			if (restricted) extra += ` ${RESTRICTED};`
			return `\t'${group}',${' '.repeat(group_len - group.length)} // ${extra}`;
		}),
		`];`,
	].join('\n'));
}

for (let {group, count, restricted} of sorted) { 
	console.log(String(count).padStart(count_len), perc(count), group, restricted ? RESTRICTED : '');
}
