import {PRINTER, UNICODE} from './unicode-version.js';
import {group_by, print_section} from './utils.js';

// get all cms
let cms = [...UNICODE.char_map.values()].filter(x => x.is_cm);

// get category names
let categories = new Map(UNICODE.read_prop_values().gc);

function sorted_tally(v, fn) {
	return [...group_by(v, fn).values()].sort((a, b) => b.length - a.length);
}

let by_og_script = sorted_tally(cms, x => x.script);
let by_script_ext = sorted_tally(cms.flatMap(c => c.get_extended().map(s => [c, s])), x => x[1]);
let by_type = sorted_tally(cms, x => x.gc.slice(1));

let pad = cms.length.toString().length;

print_section('Original Script');
for (let bucket of by_og_script) {
	console.log(`${bucket[0].script.description} (${bucket.length})`);
	for (let char of bucket) {
		console.log(`\t${char.gc} ${PRINTER.desc_for_cp(char.cp)} [${PRINTER.scripts(char.cp)}]`);
	}
}
console.log();
print_section('Original Script Totals');
for (let bucket of by_og_script) {
	console.log(`${bucket.length.toString().padStart(pad)} ${bucket[0].script.description}`);
}

console.log();
print_section('ScriptExt');
for (let bucket of by_script_ext) {
	console.log(`\t${bucket[0][1].description} (${bucket.length})`);
	for (let [char] of bucket) {
		console.log(`\t\t${char.gc} ${PRINTER.desc_for_cp(char.cp)}`);
	}
}
console.log();
print_section('ScriptExt Totals');
for (let bucket of by_script_ext) {
	console.log(`${bucket.length.toString().padStart(pad)} ${bucket[0][1].description}`);
	for (let v of sorted_tally(bucket.map(x => x[0]), x => x.gc.slice(1))) {
		let {gc} = v[0];
		console.log(`\t${v.length.toString().padStart(pad)} ${gc} ${categories.get(gc)}`);
	}
	
}



console.log();
print_section('By Type');
for (let bucket of by_type) {
	let {gc} = bucket[0];
	console.log(`${bucket.length.toString().padStart(pad)} ${gc} ${categories.get(gc)}`);
}
