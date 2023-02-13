// generate names using a distribution with custom weights

import {writeFileSync} from 'node:fs';
import {ens_normalize, nfd, is_combining_mark} from '../src/lib.js';
import {explode_cp, random_choice, random_sample} from '../src/utils.js';
import {read_spec} from './data.js';

const SPEC = read_spec();

//let all_valid = [...new Set(SPEC.groups.flatMap(g => [...g.primary, ...g.secondary]))];
//let all_parts = [...new Set(all_valid.flatMap(cp => [cp, ...nfd([cp])]))];

let all_emoji = SPEC.emoji.flatMap(cps => {
	return [cps, explode_cp(ens_normalize(String.fromCodePoint(...cps)))];
});

let reverse_map = new Map(SPEC.mapped.flatMap(([x, ys]) => {
	return ys.map(y => [y, x]);
}));

let inject_samples = SPEC.groups.map(g => {
	return random_sample([...g.primary, ...g.secondary], 100);
});	
inject_samples.push([0]); // illegal char
inject_samples.push()

const PER = 100;

let pass = SPEC.groups.flatMap(g => {
	console.log(g.name);
	const t0 = performance.now();
	let cps = [...g.primary, ...g.secondary];
	let mapped = [...new Set(cps.flatMap(cp => reverse_map.get(cp) ?? []))];
	let cm = cps.filter(cp => is_combining_mark(cp));
	let valid = cps.filter(cp => !is_combining_mark(cp));
	let names =  make_random_names([
		[10, valid],
		[3, cm],
		[3, mapped],
		[2, SPEC.ignored],
		[1, all_emoji],
	], PER, name => {
		try {
			return name !== ens_normalize(name);
		} catch (err) {
		}
	});
	return names;
});

let fail = pass.map(name0 => {
	let cps = explode_cp(name0);
	let pos = Math.random() * cps.length|0;	
	let L = String.fromCodePoint(...cps.slice(0, pos));
	let R = String.fromCodePoint(...cps.slice(pos));
	let name;
	while (true) {
		name = L + String.fromCodePoint(random_choice(random_choice(inject_samples))) + R;
		try {
			ens_normalize(name);
		} catch (err) {
			break;
		}
	}
	return name;
});

writeFileSync(new URL('./random-names.json', import.meta.url), JSON.stringify([...pass, ...fail], null, '\t'));

function make_random_names(dist, per, test, max_len = 40) {
	dist = dist.filter(([w, v]) => v.length > 0);
	let sum = dist.reduce((a, [w]) => a + w, 0);
	dist = dist.map(([w, v]) => [w / sum, v]).sort((a, b) => b[0] - a[0]); 
	let names = [];
	for (let a = 3, b = 2; a <= max_len; [a,b] = [a+b,a]) {
		names.push(...generate_random(per, dist, a, test));
	}
	return names;
}

function generate_random(samples, dist, len, test) {
	let set = new Set();
	while (set.size < samples) {
		let name = random_name(dist, len);
		if (test(name)) set.add(name);
	}
	return [...set];
}

function random_name(dist, len) {
	let v = [];
	while (v.length < len) {
		let x = weighted_sample(dist);
		if (Array.isArray(x)) {
			v.push(...x);
		} else {
			v.push(x);
		}
	}
	return String.fromCodePoint(...v);
}

// choose from weighted distribution
function weighted_sample(dist) {
	let r0 = Math.random();
	let r = r0;
	let i = 0;
	for (let e = dist.length-1; i < e; i++) {
		r -= dist[i][0];
		if (r < 0) break;
	}
	return random_choice(dist[i][1]); 
}
