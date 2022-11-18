import {Encoder, unsafe_btoa} from './encoder.js';
import {readFileSync, writeFileSync} from 'node:fs';
import {explode_cp} from './utils.js';
/*
// this appears to be bugged in 18.12.1
// randomly fails on keys
import {mapped, ignored, emoji,  fenced, escape, wholes, groups, nfc_check} from '../derive/output/spec.json' assert {type: 'json'};
import {ranks, decomp, exclusions, qc} from '../derive/output/nf.json' assert {type: 'json'};
*/

let data_dir = new URL('../derive/output/', import.meta.url);
let {mapped, ignored, emoji, cm, fenced, escape, wholes, groups, nfc_check} = JSON.parse(readFileSync(new URL('./spec.json', data_dir)));
let {ranks, decomp, exclusions, qc} = JSON.parse(readFileSync(new URL('./nf.json', data_dir)));

let emoji_solo = emoji.filter(v => v.length == 1).map(v => v[0]);
let emoji_seqs = emoji.filter(v => v.length >= 2);

class Node {
	constructor() {
		this.branches = {};
	}
	get nodes() {
		return Object.values(this.branches).reduce((a, x) => a + 1 + x.nodes, 0);
	}
	add(cp) {
		if (cp == 0xFE0F) {
			this.fe0f = true;
			return this;
		}
		let node = this.branches[cp];
		if (!node) this.branches[cp] = node = new Node();
		return node;
	}
	scan(fn, path = []) {
		fn(this, path);
		for (let [k, node] of Object.entries(this.branches)) {
			node.scan(fn, [...path, [k, node]]);
		}
	}
	collapse_nodes(memo = {}) {
		for (let [k, node] of Object.entries(this.branches)) {
			node.collapse_nodes(memo);
			let key = JSON.stringify(node);
			let dup = memo[key];
			if (dup) {
				this.branches[k] = dup;
			} else {
				memo[key] = node;
			}
		}
	}
	collapse_keys() {
		let m = Object.entries(this.branches);
		let u = this.branches = {};
		while (m.length) {
			let [key, node] = m.pop();
			u[[...m.filter(kv => kv[1] === node).map(kv => kv[0]), key].sort().join()] = node;
			m = m.filter(kv => kv[1] !== node);
			node.collapse_keys();
		}
	}
}

// insert every emoji sequence
let root = new Node();
for (let cps of emoji_seqs) {
	let node = root;
	for (let cp of cps) {
		node = node.add(cp);
	}
	node.valid = true;
}

// there are sequences of the form:
// a__ MOD b__ MOD2 c__
// where MOD != MOD2 (5x4 = 20 combinations)
// if we remember the first mod, 
// we can pretend the second mod is non-exclusionary (5x5)
// which allows further compression 
// (12193 to 11079 bytes -> saves 1KB, ~10%)
let modifier_set = new Set(['127995', '127996', '127997', '127998', '127999']); // 1F3FB..1F3FF
root.scan((node, path) => {
	// find nodes that are missing 1 modifier
	let v = Object.keys(node.branches);
	if (v.length != modifier_set.size - 1) return; // missing 1
	if (!v.every(k => modifier_set.has(k))) return; // all mods
	// where another modifier already exists in the path
	let m = path.filter(kv => modifier_set.has(kv[0]));
	if (m.length == 0) return;
	let parent = m[m.length - 1][1]; // find closest
	// complete the map so we can collapse
	for (let cp of modifier_set) {
		if (!node.branches[cp]) {
			node.branches[cp] = node.branches[v[0]]; // fake branch
			break;
		}
	}
	// set save on the first modifier
	parent.save_mod = true;
	// set check on the second modifiers
	for (let b of Object.values(node.branches)) {
		b.check_mod = true;
	}
});

// check every emoji sequence for non-standard FE0F handling
// emoji in zwj dont obey emoji presentation rules
// this should only happen with the second character of the first emoji
// eg. "A FE0F" vs. "A ZWJ B"
for (let cps of emoji_seqs) {
	let node = root;
	let i = 0;
	let n = 0; // number of fe0f
	let quirk;
	while (i < cps.length) {
		let cp = cps[i++];
		node = node.branches[cp]; // must exist
		if (i < cps.length && node.fe0f) {
			if (cps[i] == 0xFE0F) {
				i++;
			} else {
				if (n != 0) throw new Error('expected first FE0F');
				if (i != 1) throw new Error('expected second character');
				//console.log('quirk', cps, i, n);
				//bits |= 1 << n;
				quirk = true;
			}
			n++;
		}
	}
	node.quirk = quirk;
}

// compress
console.log(`Before: ${root.nodes}`);
root.collapse_nodes();
root.collapse_keys();
console.log(`After: ${root.nodes}`);

function encode_emoji(enc, node, map) {
	for (let [keys, x] of Object.entries(node.branches)) {
		enc.write_member(keys.split(',').map(k => map.get(parseInt(k))));
		encode_emoji(enc, x, map);
	}
	enc.write_member([]);
	let flag = node.quirk ? 2 : node.valid ? 1 : 0;
	let mod = node.check_mod ? 2 : node.save_mod ? 1 : 0;
	let fe0f = node.fe0f ? 1 : 0;
	//enc.unsigned(6*valid + 2*mod + fe0f); // 11888
	//enc.unsigned(6*mod + 2*valid + fe0f); // 11866
	//enc.unsigned(9*fe0f + 3*mod + valid); // 11844
	enc.unsigned(6*mod + 3*fe0f + flag); // 11833
}

function find_shared_chunks(groups, {min_overlap = 0.9, min_size = 1} = {}) {
	let union = new Set();
	let shared = new Set();
	for (let cps of groups) {
		for (let cp of cps) {
			if (union.has(cp)) {
				shared.add(cp);
			} else {
				union.add(cp);
			}
		}
	}
	let chunks = [];
	while (true) {
		groups = groups.map(cps => cps.filter(cp => shared.has(cp))).filter(cps => cps.length);
		if (groups.length <= 1) break;
		groups.sort((a, b) => b.length - a.length);
		let share = [0];
		let set0 = new Set(groups[0]);
		for (let i = 1; i < groups.length; i++) {
			let set = groups[i].filter(cp => set0.has(cp));
			if (set.length / set0.size >= min_overlap) {
				set0 = new Set(set);
				share.push(i);
			}
		}
		for (let i of share) {
			groups[i] = groups[i].filter(cp => !set0.has(cp));
		}
		if (set0.size >= min_size) {
			chunks.push([...set0]);
		}
	}
	return chunks;
}

function unique_sorted(v) {
	return [...new Set(v)].sort((a, b) => a - b);
}
function index_map(v) {
	return new Map(v.map((x, i) => [x, i]));
}

/*
if (emoji_solo.length == 0) {
	console.log(`*** There are 0 solo-emoji!`);
}
if (groups.some(g => !Number.isInteger(g.cm) || !g.cm.length)) {
	console.log(`*** There are 0 complex CM sequences!`);
}
*/
if (emoji_solo.length) {
	throw new Error(`Assumption wrong: there are solo emoji!`)
}
if (groups.some(g => Array.isArray(g.cm) && g.cm.length)) {
	throw new Error(`Assumption wrong: there are complex CM sequences!`);	
}

// assign each group to an index
// (sort was provided by derive)
groups.forEach((g, i) => g.index = i);

// map group names to groups
wholes = wholes.map(([names, cps]) => {
	return {groups: names.map(name => groups.find(g => g.name === name)), cps};
});

let enc = new Encoder();
enc.write_mapped([
	[1, 1, 0], // adjacent that map to a constant
	[2, 1, 0], // eg. AAAA..BBBB => CCCC
	[1, 1, 1], // alphabets: ABC
	[1, 2, 2], // paired-alphabets: AaBbCc
//	[1, 2, 1],
//	[1, 3, 3],
//	[3, 1, 0],
//	[4, 1, 0],
], mapped); 
enc.write_member(ignored);
/*
for (let [cp, name] of fenced) {
	enc.unsigned(cp);
	let cps = explode_cp(name);
	enc.unsigned(cps.length);
	enc.deltas(cps);
}
enc.unsigned(0);
*/
enc.write_member(cm);
enc.write_member(escape); 
enc.write_member(nfc_check); // for ens_tokenize (can probably derived)
let chunks = find_shared_chunks(groups.flatMap(g => [g.primary, g.secondary]), {min_overlap: 0.9, min_size: 256});
chunks.forEach(v => enc.write_member(v));
enc.write_member([]);
/*
// 4 char names
for (let g of groups) {
	if (g.restricted) {
		encode_lower(enc, g.name);
	}
}
*/


for (let g of groups) {
	/*
	if (g.restricted) { // 500B to enable these names
		enc.unsigned(1);
	} else {
		let cps = explode_cp(g.name);
		enc.unsigned(cps.length+1);
		enc.deltas(cps);
	}
	*/
	/*
	let alphas = explode_cp(g.name.toLowerCase()).map(cp => cp - 0x60);
	enc.unsigned(alphas.length);
	enc.deltas(alphas);
	*/
	//console.log(explode_cp(g.name.toLowerCase()).map(cp => cp - 0x60));
	enc.array(explode_cp(g.name.toLowerCase()).map(cp => cp - 0x60));
	enc.unsigned(0);
	//enc.unsigned(g.restricted|0);
	
	for (let v of [g.primary, g.secondary]) {
		let set = new Set(v);
		let parts = [];
		chunks.forEach((chunk, i) => {
			if (chunk.every(cp => set.has(cp))) {
				parts.push(i);
				chunk.forEach(cp => set.delete(cp));
			}
		});
		enc.write_member(parts);
		enc.write_member(set);
	}
	//let map = index_map([g.primary, g.secondary].flat().sort((a, b) => a-b));

	//enc.write_member(wholes.filter(w => w.groups.includes(g)).flatMap(w => w.cps).flatMap(cp => map.get(cp) ?? [])); 
	//g.wholes.forEach(({cps}) => enc.write_member(cps.map(cp => map.get(cp))));
	//enc.write_member([]);


	enc.unsigned(Array.isArray(g.cm) ? 0 : g.cm+1);
	/*
	if (Array.isArray(g.cm)) {
		enc.unsigned(0);
		for (let [cp, seqs] of g.cm) {
			enc.unsigned(1 + map.get(cp));
			for (let cps of seqs) {
				cps.forEach(cp => enc.unsigned(1 + cp)); // todo: fix
				enc.unsigned(0);
			}
			enc.unsigned(0);
		}
		enc.unsigned(0);
	} else {
		enc.unsigned(g.cm+1);
	}
	*/
}
enc.unsigned(0);

//wholes = wholes.filter(w => w.groups.length > 1);

for (let w of wholes) {
	enc.write_member(w.cps);
	enc.write_member(w.groups.map(g => g.index));
}
enc.write_member([]);

/*
enc.write_mapped([
	[1, 1, 0], // adjacent that map to a constant
	[2, 1, 0], // eg. AAAA..BBBB => CCCC
	[3, 1, 0],
], wholes.flatMap(w => w.cps.map(cp => [cp, w.groups.map(g => g.index)])));
*/

/*
enc.write_mapped([
	[1, 1, 0], // adjacent that map to a constant
	[2, 1, 0], // eg. AAAA..BBBB => CCCC
	[3, 1, 0],
], wholes.flatMap(w => w.groups.map(g => [g.index, w.cps])));
*/


let sorted_emoji = unique_sorted([emoji_solo, emoji_seqs].flat(Infinity));
let sorted_emoji_map = index_map(sorted_emoji);

enc.write_member(sorted_emoji);
//enc.write_member(emoji_solo.map(cp => sorted_emoji_map.get(cp))); 
encode_emoji(enc, root, sorted_emoji_map);

//write('include-only'); // only saves 300 bytes
write('include-ens', {
	FENCED: new Map(fenced), 
	NR: groups.filter(g => !g.restricted).length
	//NAMES: groups.map(g => g.restricted ? g.name.toLowerCase() : g.name)
});

// just nf 
// (only ~30 bytes saved using joined file)
enc = new Encoder();
for (let v of ranks) enc.write_member(v);
enc.write_member([]);
enc.write_member(exclusions);
enc.write_mapped([
	[1, 1, 0],
	[1, 1, 1],
], decomp);
enc.write_member(qc);
write('include-nf');

function write(name, vars = {}) {
	let {data, symbols} = enc.compressed();
	let encoded = unsafe_btoa(data);
	let buf = Buffer.from([
		`// created ${new Date().toJSON()}`,
		`import {read_compressed_payload} from './decoder.js';`,
		`export default read_compressed_payload('${encoded}');`,
		...Object.entries(vars).map(([k, v]) => {
			let expr;
			if (v instanceof Map) {
				expr = `new Map(${JSON.stringify([...v])})`;
			} else {
				expr = JSON.stringify(v);
			}
			return `export const ${k} = ${expr};`;
		}),
	].join('\n'));
	console.log(`${name} = ${data.length} bytes / ${symbols} symbols / ${encoded.length} base64 => ${buf.length}`);
	writeFileSync(new URL(`./${name}.js`, import.meta.url), buf);
}
