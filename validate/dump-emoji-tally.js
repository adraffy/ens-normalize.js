// computes snapshot for ens-emoji-freq.html
// https://raffy.antistupid.com/eth/ens-emoji-freq.html

import {writeFileSync} from 'node:fs';
import {read_labels} from './data.js';
import {ens_beautify, ens_emoji, ens_normalize, ens_tokenize} from '../src/lib.js';
import {hex_seq, explode_cp, group_by} from '../derive/utils.js';
//import {random_sample} from '../src/utils.js';

let labels = read_labels();
let tally = new Map(ens_emoji().map(cps => {
	let form = String.fromCodePoint(...cps);
	return [form, {form, names: []}];
}));
let some = 0;
let pure = 0;
for (let label of labels) {
	try {
		let norm = ens_normalize(label);
		if (norm !== label) continue; // not norm
 		let tokens = ens_tokenize(label);
		if (!tokens.some(t => t.emoji)) continue; // no emoji
		some++;
		if (tokens.every(t => t.emoji)) pure++;
		label = ens_beautify(label);
		for (let form of new Set(tokens.filter(t => t.emoji).map(t => String.fromCodePoint(...t.emoji)))) {
			tally.get(form).names.push(label);
		}
	} catch (err) {
	}
}
tally = [...tally.values()].sort((a, b) => b.names.length - a.names.length);

let args = process.argv.slice(2);
if (args[0] === 'save') {	
	for (let x of tally) {
		x.sample = x.names.filter(x => x.length <= 48);
	}
	let union = new Set();
	let multi = new Set();
	for (let label of tally.flatMap(x => x.sample)) {
		(union.has(label) ? multi : union).add(label);
	}
	let multi_map = new Map([...multi].map((label, i) => [label, i]));
	writeFileSync(new URL('./ens-emoji-freq.json', import.meta.url), JSON.stringify({
		date: new Date(), 
		total: labels.length,
		shared: [...multi],
		some,
		pure, 
		tally: tally.map(({names, form, sample}) => {
			return {
				form, 
				count: names.length,
				sample: sample.map(label => multi_map.get(label) ?? label),
				//sample: random_sample(names.filter(x => x.length <= 32), 64),
			};
		})
	}));
} 

console.log(new Date().toJSON());
let max = tally.reduce((a, rec) => Math.max(a, rec.names.length), 0);
let count_len = String(max).length;
for (let {names, form} of tally) {
	console.log(String(names.length).padStart(count_len), form, hex_seq(explode_cp(form)));
}
