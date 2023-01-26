// quick filter registered names by chars

// node tools/reg-count.js 640
// node tools/reg-count-js script Grek
// node tools/reg-count-js script Zyyy,Latn
// node tools/reg-count.js regex 0{445}*

import {UNICODE, PRINTER, NF} from '../derive/unicode-version.js';
import {parse_cp_range, explode_cp, print_section, group_by} from '../derive/utils.js';
import {read_labels} from '../validate/data.js';
import {ens_normalize, ens_tokenize} from '../src/lib.js';

//function ens_normalize(s) { return s; }
//function ens_tokenize() { return []; }

main(process.argv.slice(2));

function scripts_key(set) {
	return [...set].map(x => x.abbr).sort().join(',');
}

function main(args) {
	if (!args.length) throw new Error('expected args');
	let transform = x => x;
	args = args.filter(arg => {
		if (arg === '--nfd') {
			transform = x => NF.nfd(x);
		} else if (arg === '--nfc') {
			transform = x => NF.nfc(x);
		} else {
			return arg;
		}
	});
	if (args[0] === 'regex') {
		let regex = args[1].replace(/\{([0-9a-f]{2,5})\}/giu, (_, x) => String.fromCodePoint(parseInt(x, 16)));
		console.log(regex);
		try {	
			regex = new RegExp(regex, 'u');
		} catch (err) {		
			console.log(err);
			throw new TypeError(`bad regex`);
		}
		console.log(regex);
		let found = 0;
		for (let label of read_labels()) {
			if (regex.test(label)) {
				console.log(label);
				found++;
			}
		}
		console.log(`Found: ${found}`);
	} else if (args[0] === 'script-tally') {
		args.shift();
		let filter = new Set(args.flatMap(parse_cp_range));
		dump_filter(filter);
		let found = [];
		let tally = new Map();
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			if (cps.some(cp => filter.has(cp))) {
				let key = scripts_key(UNICODE.get_script_set(cps));
				let bucket = tally.get(key);
				if (!bucket) {
					bucket = [];
					tally.set(key, bucket);
				}
				bucket.push(label);
			}
		}
		for (let [key, bucket] of tally) {
			print_section(`${key} (${bucket.length})`);
			for (let label of bucket) {
				console.log(label);
			}
		}
		console.log(Object.fromEntries([...tally].map(([key, bucket]) => [key, bucket.length])));
	} else if (args[0] === 'script') {
		args.shift();
		let script = UNICODE.require_script(args.shift());
		let filter = new Set();
		for (let cp of script.map.keys()) {
			filter.add(cp);
		}
		let filters = [filter];
		if (args.length) {
			filters.push(new Set(args.flatMap(parse_cp_range)));
		}
		filters.forEach(dump_filter);
		let found = [];
		let tally = {};
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			if (filters.every(f => cps.some(cp => f.has(cp)))) {
				let key = scripts_key(UNICODE.get_script_set(cps));
				tally[key] = (tally[key] ?? 0) + 1;
				found.push(label);
			}
		}
		dump_found(found);
		console.log(tally);
		console.log(script.description);
	} else if (args[0] === 'scripts') {
		let scripts = new Set(args.slice(1).join(',')
			.split(',').map(x => x.trim()).filter(x => x)
			.map(x => UNICODE.require_script(x)));
		let key0 = scripts_key(scripts);
		let found = [];
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			if (scripts_key(UNICODE.get_script_set(cps)) === key0) {
				found.push(label);
			}
		}
		dump_found(found);
		for (let script of scripts) {
			console.log(script.description);
		}
	} else if (args[0] === 'ext') {
		let abbr0 = args[1];
		let found = 0;
		let tally = {};
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			let set = UNICODE.get_extended_script_set(cps);
			if (set.has(abbr0)) {
				let key = [...set].sort().join(',');
				tally[key] = (tally[key] ?? 0) + 1;
				console.log(`${label} <${key}>`);
				found++;
			}
		}
		console.log(`Found: ${found}`);
		console.log(tally);
	} else if (args[0] === 'aug') {
		let script0 = UNICODE.require_script(args[1]);
		let found = 0;
		let tally = {};
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			let set = UNICODE.get_augmented_script_set(cps);
			if (set.has(script0)) {
				let key = [...set].sort().join(',');
				tally[key] = (tally[key] ?? 0) + 1;
				console.log(`${label} <${key}>`);
				found++;
			}
		}
		console.log(`Found: ${found}`);
		console.log(tally);
	} else if (args[0] === 'reg-tally') {
		let tally = new Map();
		for (let label of read_labels()) {
			let set = new Set();
			for (let token of ens_tokenize(label, {nf: false})) {
				switch (token.type) {
					//case 'valid': 
					//case 'mapped': 
					//	token.cps.forEach(cp => union.add(cp)); break;
					case 'disallowed':
						set.add(token.cp);
						break;	
				}
			}
			if (set.size) {
				for (let cp of set) {
					let bucket = tally.get(cp);
					if (!bucket) {
						bucket = [];
						tally.set(cp, bucket);
					}
					bucket.push(label);
				}
			}
		}
		tally = [...tally.entries()]
			.map(([cp, v]) => ({cp, v}))
			.filter(x => x.v.length)
			.sort((a, b) => b.v.length - a.v.length);

		let pad = String(tally[0].v.length).length;
		for (let {cp, v} of tally) {
			console.log(String(v.length).padStart(pad), UNICODE.get_display(cp),  UNICODE.get_name(cp));
		}
		console.log(tally.length);
	} else if (args[0] === 'tally-max-cm') {
		let tally = {};
		for (let label of read_labels()) {			
			let cps = transform(explode_cp(label));
			let max = 0;
			for (let i = 0; i < cps.length; i++) {
				let first = i;
				while (i < cps.length && UNICODE.cm.has(cps[i])) i++;
				max = Math.max(max, i - first);
			}
			if (max) {
				tally[max] = (tally[max] ?? 0) + 1;
			}
		}
		console.log(tally);
	} else if (args[0] === 'tally-cm-runs') {
		let tally = {};
		for (let label of read_labels()) {			
			let cps = transform(explode_cp(label));
			for (let i = 0; i < cps.length; i++) {
				let first = i;
				while (i < cps.length && UNICODE.cm.has(cps[i])) i++;
				let run = first - i;
				if (run) {					
					tally[run] = (tally[run] ?? 0) + 1;
				}
			}
		}
		console.log(tally);
	} else if (args[0] === 'multi-cm') {
		let min = parseFloat(args[1]);
		if (!Number.isInteger(min) || min < 1) throw new Error(`expected run length`);
		console.log(`Min Run: ${min}`);
		let found = [];
		for (let label of read_labels()) {			
			let cps = transform(explode_cp(label));
			let max = 0;
			for (let i = 0; i < cps.length; i++) {
				let first = i;
				while (i < cps.length && UNICODE.cm.has(cps[i])) i++;
				max = Math.max(max, i - first);
			}
			if (max >= min) {
				found.push(label);
			}
		}
		for (let [key, bucket] of group_by(found, s => [...UNICODE.get_script_set(s)].map(x => x.abbr).sort().join('_'))) {
			print_section(key);
			//dump_found(bucket);
			console.log(bucket.length);
		}

	} else {
		let filter = new Set();
		let filters = [filter];
		for (let arg of args) {
			if (arg == '+') {
				filter = new Set();
				filters.push(filter);
			} else {
				for (let cp of parse_cp_range(arg)) {
					filter.add(cp);
				}
			}
		}
		filters.forEach(dump_filter);
		let found = [];
		for (let label of read_labels()) {
			let cps = transform(explode_cp(label));
			if (filters.every(f => cps.some(cp => f.has(cp)))) {
				found.push(label);
			}
		}
		dump_found(found);
	}
}

function dump_filter(filter) {
	for (let cp of filter) {
		console.log(PRINTER.js(cp));
	}
	console.log(`Filter: ${filter.size}`);
}

function dump_found(found) {
	let same = [];
	let diff = [];
	let fail = [];
	for (let rec of found) {
		let label, extra;
		if (typeof rec === 'string') {
			label = rec;
			extra = '';
		} else {
			label = rec.label;
			extra = rec.extra;
		}
		try {
			let norm = ens_normalize(label);
			if (norm === label) {
				same.push({label, extra});
			} else {
				diff.push({label, norm, extra});
			}
		} catch (err) {
			fail.push({label, extra, error: err.message});
		}
	}
	print_section(`Same (${same.length})`);
	for (let {label, extra} of same) {
		console.log(`${label}${extra}`);
	}
	print_section(`Diff (${diff.length})`);
	for (let {norm, label, extra} of diff) {
		console.log(`${label} => ${norm}${extra}`);
	}
	print_section(`Fail (${fail.length})`);
	for (let {label, extra, error} of fail) {
		console.log(`${label}${extra} => ${error}`);
	}
	console.log({
		found: found.length,
		same: same.length,
		diff: diff.length,
		fail: fail.length
	});
}