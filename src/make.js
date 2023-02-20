import {Encoder, unsafe_btoa} from './encoder.js';
import {readFileSync, writeFileSync} from 'node:fs';
import {explode_cp} from './utils.js';
import {compute_spec_hash} from './make-utils.js';

/*
// import ... assert {type: 'json'} appears to be bugged in node 18.12.1
// randomly fails on keys
import {mapped, ignored, emoji,  fenced, escape, wholes, groups, nfc_check} from '../derive/output/spec.json' assert {type: 'json'};
import {ranks, decomp, exclusions, qc} from '../derive/output/nf.json' assert {type: 'json'};
*/

let data_dir = new URL('../derive/output/', import.meta.url);
let spec_file = new URL('./spec.json', data_dir);
let nf_file = new URL('./nf.json', data_dir);

let {mapped, ignored, emoji, cm, nsm, nsm_max, wholes, groups, fenced, escape, nfc_check, ...spec} = JSON.parse(readFileSync(spec_file));
let {ranks, decomp, exclusions, qc} = JSON.parse(readFileSync(nf_file));
let {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

let emoji_solo = emoji.filter(v => v.length == 1).map(v => v[0]);
let emoji_seqs = emoji.filter(v => v.length >= 2);

// check assumptions
if (emoji_solo.length) {
	// all emoji have been force emoji-styled to prevent any shenanigans 
	throw new Error(`Assumption wrong: there are solo emoji!`)
}
if (groups.some(g => Array.isArray(g.cm) && g.cm.length)) {
	// the code for this is currently commented out
	throw new Error(`Assumption wrong: there are complex CM sequences!`);	
}

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
// emoji with ZWJ dont obey emoji presentation rules
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
console.log('Compress Emoji:')
console.log(` Before: ${root.nodes}`);
root.collapse_nodes();
root.collapse_keys();
console.log(`  After: ${root.nodes}`);

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
			(union.has(cp) ? shared : union).add(cp);
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
let prev = 0;
function log_bytes(name) {
	let next = enc.compressed().data.length;
	console.log(name, next-prev);
	prev = next;
}
*/

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
], mapped); // ~7KB

enc.write_member(ignored); // ~30B
enc.write_member(cm); // ~600B
enc.write_member(nsm.map(x => cm.indexOf(x))); // saves 300 bytes
enc.write_member(escape); // ~60B
enc.write_member(nfc_check); // ~320B for ens_tokenize (can probably be derived)
let chunks = find_shared_chunks(groups.flatMap(g => [g.primary, g.secondary]), {min_overlap: 0.9, min_size: 256});
chunks.forEach(v => enc.write_member(v)); // 400B
enc.write_member([]);
enc.unsigned(groups.filter(g => !g.restricted).length); 
for (let g of groups) {
	// all names are "Abcd...e"
	// (which can be auto-capitalized)
	// for unrestricted, names are primary-script/language names
	// for restricted, names are just script abbr
	enc.array(explode_cp(g.name.toLowerCase()).map(cp => cp - 0x60));
	enc.unsigned(0);
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
	// if we have an CM array, we are whitelisted
	enc.unsigned(Array.isArray(g.cm)|0);
	// *** this code isn't needed based on current assumptions ***
	/*
	let map = index_map([g.primary, g.secondary].flat().sort((a, b) => a-b));
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

// wholes a Nx2xRagged array:
// eg. [[valid, ...], [confused, ...]]
// to compress:
// encode the union of valid (first column)
// encode the union of confused (second column)
// encode the ragged array as back-refs
//   use back-refs to find char
//      0  => new whole
//      1+ => add to previous whole
//   use sets to determine if valid/confused
let flat_wholes = wholes.flatMap(w => {
	return [
		w.valid.map(cp => ({cp, w, valid: true})),
		w.confused.map(cp => ({cp, w}))
	].flat()
}).sort((a, b) => a.cp - b.cp);
enc.write_member(flat_wholes.filter(f => f.valid).map(f => f.cp));
enc.write_member(flat_wholes.filter(f => !f.valid).map(f => f.cp));
flat_wholes.forEach((f, i) => {
	if (f.w.last === undefined) {
		enc.unsigned(0);	
	} else {
		enc.unsigned(i - f.w.last);
	}
	f.w.last = i;
}); // ~2KB

let sorted_emoji = unique_sorted([emoji_solo, emoji_seqs].flat(Infinity));
let sorted_emoji_map = index_map(sorted_emoji);
enc.write_member(sorted_emoji);
// *** this code isn't needed based on current assumptions ***
//enc.write_member(emoji_solo.map(cp => sorted_emoji_map.get(cp))); 
encode_emoji(enc, root, sorted_emoji_map); // ~2KB

const built = new Date().toJSON();

//write('include-only'); // only saves 300 bytes
write('include-ens', {
	FENCED: new Map(fenced),
	NSM_MAX: nsm_max,
});

// just nf
// this is kept separate so we can have independent nf.js
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

// write version info
const versions = {
	derived: spec.created,
	unicode: spec.unicode,
	cldr: spec.cldr,
	spec_hash: compute_spec_hash(spec_file),
	built,
	version
};
console.log(versions);
writeFileSync(new URL('./include-versions.js', import.meta.url), Object.entries(versions).map(([k, v]) => {
	return `export const ${k} = ${JSON.stringify(v)};`;
}).join('\n'));

function write(name, vars = {}) {
	let {data, symbols} = enc.compressed();
	let encoded = unsafe_btoa(data);
	let buf = Buffer.from([
		`// created ${built}`,
		`import {read_compressed_payload} from './decoder.js';`,
		`export default read_compressed_payload('${encoded}');`,
		...Object.entries(vars).map(([k, v]) => {
			let expr;
			if (v instanceof Map) {
				expr = `new Map(${JSON.stringify([...v])})`;
			} else if (v instanceof Set) {
				expr = `new Set(${JSON.stringify([...v])})`;
			} else {
				expr = JSON.stringify(v);
			}
			return `export const ${k} = ${expr};`;
		}),
	].join('\n'));
	console.log(`${name} [${data.length} bytes, ${symbols} symbols, ${encoded.length} base64] => ${buf.length} bytes`);
	writeFileSync(new URL(`./${name}.js`, import.meta.url), buf);
	//writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify(enc.values.slice()));
}
