import {ens_normalize, ens_emoji} from '../src/lib.js';
import {bytes_from_utf8} from '../derive/utils.js';
import {read_labels} from '../validate/data.js';

const LABELS = read_labels();
const MAX_WRAP = 255;

let valid = 0;
let wrappable = 0;
for (let label of LABELS) {
	try {
		let norm = ens_normalize(label);
		valid++;
		let n = bytes_from_utf8(norm).length;
		if (n <= MAX_WRAP) wrappable++;
	} catch (err) {
	}	
}
console.log({valid, wrappable});