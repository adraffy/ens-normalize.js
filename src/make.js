import {Encoder, unsafe_btoa} from './encoder.js';
import {readFileSync, writeFileSync} from 'node:fs';

let data_dir = new URL('../derive/output/', import.meta.url);
let {valid, mapped, ignored, cm, isolated, emoji, scripts, wholes, excluded} = JSON.parse(readFileSync(new URL('./spec.json', data_dir)));
let {ranks, decomp, exclusions, qc} = JSON.parse(readFileSync(new URL('./nf.json', data_dir)));

let emoji_solo = emoji.filter(v => v.length == 1);
let emoji_seqs = emoji.filter(v => v.length >= 2);

// union of non-zero combining class + nfc_qc
let nfc_check = [...new Set([ranks, qc].flat(Infinity))].filter(cp => valid.includes(cp));

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
		enc.write_member(keys.split(',').map(k => map[k]));
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

function unique_sorted(v) {
	return [...new Set(v)].sort((a, b) => a - b);
}
function index_map(v) {
	return Object.fromEntries(v.map((x, i) => [x, i]));
}

let sorted_valid = unique_sorted(valid);
let sorted_valid_map = index_map(sorted_valid);

let sorted_emoji = unique_sorted(emoji_seqs.flat());
let sorted_emoji_map = index_map(sorted_emoji);

let enc = new Encoder();
enc.write_member(valid);
enc.write_member(ignored);
enc.write_mapped([
	[1, 1, 0], // adjacent that map to a constant
	[2, 1, 0], // eg. AAAA..BBBB => CCCC
	[1, 1, 1], // alphabets: ABC
	[1, 2, 2], // paired-alphabets: AaBbCc
//	[1, 2, 1],
//	[1, 3, 3],
//	[3, 1, 0],
//	[4, 1, 0],
], mapped); //.map(kv => [kv[0], kv[1].map(x => sorted_valid_map[x])])); // not worth it
function write_valid_sorted(cps) {
	enc.write_member(cps.map(cp => sorted_valid_map[cp]));
}
write_valid_sorted(cm);
write_valid_sorted(isolated);
write_valid_sorted(scripts.Latn);
write_valid_sorted(scripts.Grek);
write_valid_sorted(wholes.Grek);
write_valid_sorted(scripts.Cyrl);
write_valid_sorted(wholes.Cyrl);
for (let cps of Object.values(excluded)) {
	write_valid_sorted(cps);
}
enc.write_member([]);
enc.write_member(emoji_solo.map(v => v[0]));
enc.write_member(sorted_emoji);
encode_emoji(enc, root, sorted_emoji_map);
//write('include-only'); // only saves 300 bytes
write_valid_sorted(nfc_check);
write('include-ens');

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

function write(name) {
	let buf = Buffer.from(enc.compressed());
	console.log(`${name} = ${buf.length} bytes`);
	let encoded = unsafe_btoa(buf);
	writeFileSync(new URL(`./${name}.js`, import.meta.url), [
		`// created ${new Date().toJSON()}`,
		`import {read_compressed_payload} from './decoder.js';`,
		`export default read_compressed_payload('${encoded}');`,
	].join('\n'));
}
