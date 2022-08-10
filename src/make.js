import {CHARS, EMOJI} from '@adraffy/ensip-norm';
import {Encoder} from './encoder.js';
import {writeFileSync} from 'node:fs';
import NFC_CHECK from './nfc-check.js';

class Node {
	constructor() {
		this.branches = {};
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

let root = new Node();
for (let cps of EMOJI) {
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
// (12193 to 11079 bytes -> saves 1KB)
let modifier_set = new Set([0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF].map(x => String(x))); // 1F3FB..1F3FF
root.scan((node, path) => {
	// find nodes that are missing 1 modifier
	let v = Object.keys(node.branches);
	if (v.length != modifier_set.size - 1) return; 
	if (!v.every(k => modifier_set.has(k))) return;
	// where another modifier already exists in the path
	let m = path.filter(kv => modifier_set.has(kv[0]));
	if (m.length == 0) return;
	let parent = m[m.length - 1][1];
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

// assert invariants
root.scan((node) => {
	if (node.save_mod && node.check_mod) throw new Error('invariant wrong');
});

// compress
root.collapse_nodes();
root.collapse_keys();

function encode_emoji(enc, node, map) {
	for (let [keys, x] of Object.entries(node.branches)) {
		enc.write_member(keys.split(',').map(x => sorted_emoji_map[x]));
		encode_emoji(enc, x, map);
	}
	enc.write_member([]);
	let flag = 0;
	if (node.valid)     flag |= 1;
	if (node.fe0f)      flag |= 2;
	if (node.save_mod)  flag |= 4;
	if (node.check_mod) flag |= 8;
	enc.unsigned(flag);
}

function unique_sorted(v) {
	return [...new Set(v)].sort((a, b) => a - b);
}
function index_map(v) {
	return Object.fromEntries(v.map((x, i) => [x, i]));
}

let sorted_valid = unique_sorted(CHARS.valid);
let sorted_valid_map = index_map(sorted_valid);

let sorted_emoji = unique_sorted(EMOJI.flat());
let sorted_emoji_map = index_map(sorted_emoji);

let enc = new Encoder();
enc.write_member(CHARS.valid);
enc.write_member(CHARS.ignored);
enc.write_mapped([
	[1, 1, 0], // adjacent that map to a constant
	[2, 1, 0], // eg. AAAA..BBBB => CCCC
	[1, 1, 1], // alphabets: ABC
	[1, 2, 2], // paired-alphabets: AaBbCc
//	[1, 2, 1],
//	[1, 3, 3],
//	[3, 1, 0],
//	[4, 1, 0],
], CHARS.mapped);
enc.write_member(sorted_emoji);
encode_emoji(enc, root, sorted_emoji_map);
enc.write_member(NFC_CHECK.flatMap(cp => sorted_valid_map[cp] ?? []));
let buf = Buffer.from(enc.compressed());

console.log(`${buf.length} bytes`);

writeFileSync(new URL('./include.js', import.meta.url), `
	import {read_compressed_payload} from './decoder.js';
	export default read_compressed_payload(Uint8Array.from(atob('${buf.toString('base64')}'), c => c.charCodeAt(0)));
`);