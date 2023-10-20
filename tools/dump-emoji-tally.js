// computes snapshot for ens-emoji-freq.html
// https://raffy.antistupid.com/eth/ens-emoji-freq.html
// these are known label fragments from various sources
// (NameRegistered, NameRenewed, ReverseResolver scanning, etc.)
// note: a very small percentage might not be registered
// eg. "a.b".eth is invalid but results in ["a", "b"] fragments

import {writeFileSync} from 'node:fs';
import {read_labels} from '../validate/data.js';
import {ensEmoji, ensNormalize, ensTokenize} from '../src/lib.js';
import {hex_seq, explodeCp} from '../derive/utils.js';
//import {random_sample} from '../src/utils.js';

const MIN_LEN = 3;
const MAX_LEN = 128;

let labels = read_labels();
//let labels = JSON.parse(readFileSync(new URL('../../ens-labels/labels.json', import.meta.url)));
let tally = new Map(ensEmoji().map(cps => {
	let form = String.fromCodePoint(...cps);
	return [form, {form, names: []}];
}));
let some = 0;
let pure = 0;
for (let label of labels) {
	try {
		let norm = ensNormalize(label);
		if (norm !== label) continue; // not norm
		if ([...norm].length < MIN_LEN) continue; // too short
 		let tokens = ensTokenize(label);
		if (!tokens.some(t => t.emoji)) continue; // no emoji
		some++;
		if (tokens.every(t => t.emoji)) pure++;
		//label = ensBeautify(label); // make it purdy (2023012: nah, store normalized: ~15% reduction in file size)
		for (let form of new Set(tokens.filter(t => t.emoji).map(t => String.fromCodePoint(...t.emoji)))) {
			tally.get(form).names.push(norm); // +1 per unique emoji per name
		}
	} catch (err) {
	}
}

/*
for (let [key,x] of tally) {
	//x.names = x.names.filter(x => [...ensNormalize(x)].length == 4);
	x.names = x.names.filter(x => x.startsWith('0x'));
	if (!x.names.length) {
		tally.delete(key);
	}
}
*/

tally = [...tally.values()].sort((a, b) => b.names.length - a.names.length);

let args = process.argv.slice(2);
if (args[0] === 'save') {	
	for (let x of tally) {
		// sort by length and then lexical
		x.sample = x.names.filter(x => [...x].length <= MAX_LEN).sort((a, b) => {
			let c = [...a].length - [...b].length;
			if (c == 0) c = a.localeCompare(b);
			return c;
		});
	}
	// collect all labels that are used more that once and 
	// replace them with an integer for reduced file size
	let union = new Set();
	let multi = new Set();
	for (let label of tally.flatMap(x => x.sample)) {
		(union.has(label) ? multi : union).add(label);
	}
	let multi_map = new Map([...multi].map((label, i) => [label, i]));
	let out_file = new URL('./output/ens-emoji-freq.json', import.meta.url);
	writeFileSync(out_file, JSON.stringify({
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
	console.log(`Wrote: ${out_file}`);
} else {
	console.log(new Date().toJSON());
	let max = tally.reduce((a, rec) => Math.max(a, rec.names.length), 0);
	let count_len = String(max).length;
	for (let {names, form} of tally) {
		console.log(String(names.length).padStart(count_len), form, hex_seq(explodeCp(form)));
	}
}
