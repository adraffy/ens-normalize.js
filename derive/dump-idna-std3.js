import {UnicodePrinter, UnicodeSpec} from './unicode-logic.js';
import {hex_cp, parse_cp_range, parse_cp_sequence, print_section} from './utils.js';

const unicode = UnicodeSpec.from_release('15.1');
const printer = new UnicodePrinter(unicode);

const {disallowed_STD3_valid, disallowed_STD3_mapped} = unicode.read_idna();

print_section('disallowed_STD3_mapped');
for (let [xs, ys] of disallowed_STD3_mapped) {
	const cps = parse_cp_sequence(ys);
	for (let cp of parse_cp_range(xs)) {
		console.log(`0x${hex_cp(cp)}, // ${printer.desc_for_mapped(cp, cps)}`);
	}
}

console.log();
print_section('disallowed_STD3_valid');
for (let cp of disallowed_STD3_valid.flatMap(parse_cp_range)) {
	console.log(`0x${hex_cp(cp)}, // ${printer.desc_for_cp(cp)}`);
}
