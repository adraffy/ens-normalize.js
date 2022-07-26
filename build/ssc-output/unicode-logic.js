import {read_parsed} from '../nodejs-utils.js';
import {parse_cp_multi_ranges, parse_cp_sequence} from '../utils.js';
import {nfc} from '../nf.js';
import EXTRA from '../rules/extra-confusables.js';

export function read_confusable_sets() {
	let pairs = Object.entries(read_parsed('confusables')).flatMap(([x, ys]) => {
		x = parse_cp_sequence(x);
		return ys.map(y => [x, parse_cp_sequence(y)]);
	});
	let removed = [];
	for (let input of EXTRA) {
		try {
			if (Array.isArray(input)) { // add
				if (input.length < 2) throw new Error('expected 2+');
				let v = input.map(parse_cp_sequence);
				for (let i = 1; i < v.length; i++) {
					pairs.push([v[0], v[i]]);
				}
			} else { // remove
				removed.push(String.fromCodePoint(...parse_cp_sequence(input)));
			}
		} catch (err) {
			console.log(`Invalid Extra Confusable: ${input}`);
			throw err;
		}
	}
	console.log(removed);
	let groups = [];
	let map = {};
	for (let [a, b] of pairs) {
		let aa = String.fromCodePoint(...nfc(a));
		let bb = String.fromCodePoint(...nfc(b));
		if (aa === bb) continue;
		let aaa = map[aa];
		let bbb = map[bb];
		if (aaa && bbb && aaa !== bbb) throw new Error('wtf'); // or link them together?
		if (aaa) {
			map[bb] = bbb = aaa;
		} else if (bbb) {
			map[aa] = aaa = bbb;
		} else {
			map[aa] = map[bb] = aaa = bbb = new Set();
			groups.push(aaa);
		}
		aaa.add(aa);
		aaa.add(bb);
	}
	for (let form of removed) {
		let i = groups.findIndex(set => set.has(form));
		if (i < 0) throw new Error(`Couldn't find confusable: ${form}`);
		console.log(`Deleted: ${form}`);
		groups[i].delete(form);
	}
	return groups.filter(x => x.size >= 2);	
}