import {writeFileSync} from 'fs';
import {parse_cp_multi_ranges} from './utils.js';

const GROUP = {};
const MATRIX = {};


define_matrix('Digits', '0123456789');
define_matrix('Letter', 'abcdefghijklmnopqrstuvwxyz');
define_matrix('GreekLetter', 'αβγδεζηθικλμνξοπρστυφχψω');
//define_matrix('Ordinals', 30);
//add_group('Control', '2D 5F');

add_matrix_row('Digits', 'Latin', '30..39');
add_matrix_row('Digits', 'Latin-FullWidth', 'FF10..FF19');
add_matrix_row('Digits', 'Math-Bold', '1D7CE..1D7D7');
add_matrix_row('Digits', 'Math-DoubleStruck', '1D7D8..1D7E1');
add_matrix_row('Digits', 'Math-SansSerif', '1D7E2..1D7EB');
add_matrix_row('Digits', 'Math-SansSerif-Bold', '1D7EC..1D7F5');
add_matrix_row('Digits', 'Math-Monospace', '1D7F6..1D7FF');
add_matrix_row('Digits', 'Superscript', '2070 00B9 00B2 00B3 2074..2079');
add_matrix_row('Digits', 'Math-DoubleStruck', '1D7D8..1D7E1');
add_matrix_row('Digits', 'Circled-10x', '0 3248..324F 0');
add_matrix_row('Digits', 'Circled-20+', '0 3251..3259');
add_matrix_row('Digits', 'Circled-30+', '325A..325F 32B1..32B4');
add_matrix_row('Digits', 'Circled-40+', '32B5..32BE');
add_matrix_row('Digits', 'Circled-50+', '32BF 0 0 0 0 0 0 0 0 0');
add_matrix_row('Digits', 'Circled-Ideograph', '3289 3280..3288')

add_matrix_row('Letter', 'Latin-Capital', '41..5A');
add_matrix_row('Letter', 'Latin-Small', '61..7A');
add_matrix_row('Letter', 'Latin-Small-Middle-Tilde', '0 1D6C 0 1D6D 0 1D6E 0 0 0 0 0 26B 1D6F..1D70 0 1D71 0 1D72 1D74..1D75 0 0 0 0 0 1D76');
add_matrix_row('Letter', 'Latin-Small-Stroke', '2C65 180 23C 111 247 A799 1E5 127 268 249 A741 142 0 0 F8 1D7D 0 24D 0 167 A7B9 0 0 0 24F 1B6');
add_matrix_row('Letter', 'Latin-FullWidth-Capital', 'FF21..FF3A');
add_matrix_row('Letter', 'Latin-FullWidth-Small', 'FF41..FF5A');
add_matrix_row('Letter', 'Latin-Combining', '363 0 368..369 364 0 0 36A 365 0 0 0 36B 0 366 0 0 36C 0 36D 367 36E 0 36F 0 0');
add_matrix_row('Letter', 'Math-Bold-Capital', '1D400..1D419');
add_matrix_row('Letter', 'Math-Bold-Small', '1D41A..1D433');
add_matrix_row('Letter', 'Math-Italic-Capital', '1D434..1D44D');
add_matrix_row('Letter', 'Math-Italic-Small', '1D44E..1D467');
add_matrix_row('Letter', 'Math-Bold-Italic-Capital', '1D468..1D481');
add_matrix_row('Letter', 'Math-Bold-Italic-Small', '1D482..1D49B');
add_matrix_row('Letter', 'Math-Script-Capital', '1D49C 0 1D49E..1D49F 0 0 1D4A2 0 0 1D4A5..1D4A6 0 0 1D4A9..1D4AC 0 1D4AE..1D4B5');
add_matrix_row('Letter', 'Math-Script-Small', '1D4B6..1D4B9 0 1D4BB 0 1D4BD..1D4C3 0 1D4C5..1D4CF');
add_matrix_row('Letter', 'Math-Bold-Script-Capital', '1D4D0..1D4E9');
add_matrix_row('Letter', 'Math-Bold-Script-Small', '1D4EA..1D503');
add_matrix_row('Letter', 'Math-Fraktur-Capital', '1D504..1D505 0 1D507..1D50A 0 0 1D50D..1D514 0 1D516..1D51C 0');
add_matrix_row('Letter', 'Math-Fraktur-Small', '1D51E..1D537');
add_matrix_row('Letter', 'DoubleStruck-Capital', '0 0 2102 0 0 0 0 210D 0 0 0 0 0 2115 0 2119..211A 211D 0 0 0 0 0 0 0 2124');
add_matrix_row('Letter', 'DoubleStruck-Italic-Small', '0 0 0 2146..2147 0 0 0 2148..2149 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0');
add_matrix_row('Letter', 'Math-DoubleStruck-Capital', '1D538..1D539 0 1D53B..1D53E 0 1D540..1D544 0 1D546 0 0 0 1D54A..1D550 0');
add_matrix_row('Letter', 'Math-DoubleStruck-Small', '1D552..1D56B');
add_matrix_row('Letter', 'Math-Bold-Fraktur-Capital', '1D56C..1D585');
add_matrix_row('Letter', 'Math-Bold-Fraktur-Small', '1D586..1D59F');
add_matrix_row('Letter', 'Math-SansSerif-Capital', '1D5A0..1D5B9');
add_matrix_row('Letter', 'Math-SansSerif-Small', '1D5BA..1D5D3');
add_matrix_row('Letter', 'Math-SansSerif-Bold-Capital', '1D5D4..1D5ED');
add_matrix_row('Letter', 'Math-SansSerif-Bold-Small', '1D5EE..1D607');
add_matrix_row('Letter', 'Math-SansSerif-Italic-Capital', '1D608..1D621');
add_matrix_row('Letter', 'Math-SansSerif-Italic-Small', '1D622..1D63B');
add_matrix_row('Letter', 'Math-SansSerif-Bold-Italic-Capital', '1D63C..1D655');
add_matrix_row('Letter', 'Math-SansSerif-Bold-Italic-Small', '1D656..1D66F');
add_matrix_row('Letter', 'Math-Monospace-Capital', '1D670..1D689');
add_matrix_row('Letter', 'Math-Monospace-Small', '1D68A..1D6A3');
add_matrix_row('Letter', 'Latin-Subscript-Small', '2090 0 0 0 2091 0 0 2095 0 0 2096..2099 2092 209A 0 0 209B..209C 0 0 0 2093 0 0');

add_matrix_row('GreekLetter', 'Capital', '391..3A1 3A3..3A9');
add_matrix_row('GreekLetter', 'Small', '3B1..3C2 3C4..3C9');
add_matrix_row('GreekLetter', 'DoubleStruck-Small', '0 0 213D 0 0 0 0 0 0 0 0 0 0 0 0 213C 0 0 0 0 0 0 0 0');
add_matrix_row('GreekLetter', 'DoubleStruck-Capital', '0 0 213E 0 0 0 0 0 0 0 0 0 0 0 0 213F 0 0 0 0 0 0 0 0');



/*
add('A', 'Grave', '00C0');
add('A', 'Acute', '00C1');
*/

function define_matrix(key, chrs) {
	let rec = MATRIX[key];
	if (rec) throw new Error(`already defined: ${key}`);
	if (typeof chrs === 'number') {
		chrs = Array(chrs).map((_, i) => String(i+1));
	}
	MATRIX[key] = {name: key, chrs: [...chrs], rows: []};
}

function add_matrix_row(key, name, src) {
	let rec = MATRIX[key];
	if (!rec) throw new Error(`unknown matrix: ${key}`);	
	let cps = parse_cp_multi_ranges(src);
	if (cps.length != rec.chrs.length) throw new Error(`mismatch ${key} ${name}`);	
	rec.rows.push({name, cps});
}




//writeFileSync('./output/groups.json', JSON.stringify({groups: GROUP, matrix: MATRIX}));