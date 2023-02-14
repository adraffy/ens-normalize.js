import {PRINTER, UNICODE} from './unicode-version.js';
import {group_by, print_section} from './utils.js';

// get all cms
let cms = [...UNICODE.char_map.values()].filter(x => x.is_cm);

// get category names
let categories = new Map(UNICODE.read_prop_values().gc);

function sorted_tally(v, fn) {
	return [...group_by(v, fn).values()].sort((a, b) => b.length - a.length);
}

let by_script = sorted_tally(cms, x => x.script);
let by_type = sorted_tally(cms, x => x.gc.slice(1));

for (let bucket of by_script) {
	print_section(`${bucket[0].script.description} (${bucket.length})`);
	for (let char of bucket) {
		//console.log(PRINTER.js(char.cp));
		console.log(`${char.gc} ${PRINTER.desc_for_cp(char.cp)} [${PRINTER.scripts(char.cp)}]`);
	}
}

let pad = 5;

console.log();
print_section('By Script');
for (let bucket of by_script) {
	console.log(`${bucket.length.toString().padStart(pad)} ${bucket[0].script.description}`);
}

console.log();
print_section('By Type');
for (let bucket of by_type) {
	let {gc} = bucket[0];
	console.log(`${bucket.length.toString().padStart(pad)} ${gc} ${categories.get(gc)}`);
}
