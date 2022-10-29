// quick filter registered names by chars

// node tools/reg-count.js 640
// node tools/reg-count-js script Grek
// node tools/reg-count-js script Zyyy,Latn
// node tools/reg-count.js regex 0{445}*

import {UNICODE, SCRIPTS} from '../derive/unicode-version.js';
import {CHANGED_SCRIPTS} from '../derive/rules/scripts.js';
import {parse_cp_range, explode_cp} from '../derive/utils.js';
import {read_labels} from '../validate/data.js';
import {ens_normalize} from '../src/lib.js';

SCRIPTS.apply_changes(CHANGED_SCRIPTS);

main(process.argv.slice(2));

function main(args) {
	if (!args.length) throw new Error('expected args');
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
	} else if (args[0] === 'script') {
		args.shift();
		let script = SCRIPTS.require(args.shift());
		let filter = new Set();
		for (let cp of script.set) {
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
				let key = [...SCRIPTS.get_script_set(cps)].sort().join('_');
				tally[key] = (tally[key] ?? 0) + 1;
				found.push(label);
			}
		}
		dump_found(found);
		console.log(tally);
		console.log(script.name);
	} else if (args[0] === 'scripts') {
		function set_key(set) {
			return [...set].sort().join(',');
		}
		let key0 = set_key(new Set(args.slice(1).join(',')
			.split(',').map(x => x.trim()).filter(x => x)
			.map(x => SCRIPTS.require(x).abbr)));
		let found = 0;
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			if (set_key(SCRIPTS.get_script_set(cps)) === key0) {
				console.log(label);
				found++;
			}
		}
		console.log(`Found: ${found}`);
	} else if (args[0] === 'ext') {
		let abbr0 = args[1];
		let found = 0;
		let tally = {};
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			let set = SCRIPTS.get_extended_script_set(cps);
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
		let abbr0 = args[1];
		let found = 0;
		let tally = {};
		for (let label of read_labels()) {
			let cps = explode_cp(label);
			let set = SCRIPTS.get_augmented_script_set(cps);
			if (set.has(abbr0)) {
				let key = [...set].sort().join(',');
				tally[key] = (tally[key] ?? 0) + 1;
				console.log(`${label} <${key}>`);
				found++;
			}
		}
		console.log(`Found: ${found}`);
		console.log(tally);
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
			let cps = explode_cp(label);
			if (filters.every(f => cps.some(cp => f.has(cp)))) {
				found.push(label);
			}
		}
		dump_found(found);
	}
}

function dump_filter(filter) {
	for (let cp of filter) {
		console.log(UNICODE.format(cp));
	}
	console.log(`Filter: ${filter.size}`);
}

function dump_found(found) {
	let pass = [];
	let fail = [];
	for (let label of found) {
		try {
			ens_normalize(label);
			pass.push(label);
		} catch (err) {
			fail.push(label);
		}
	}
	console.log('[Pass]');
	for (let label of pass) {
		console.log(label);
	}
	console.log();
	console.log('[Fail]');
	for (let label of fail) {
		console.log(label);
	}
	console.log({
		found: found.length,
		pass: pass.length,
		fail: fail.length
	});
}