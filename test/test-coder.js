import {Encoder, base64} from '../build/encoder.js';
import {decode_payload, read_mapped_table} from '../build/decoder.js';

let enc = new Encoder();
enc.write_mapped([
	[1, 1, 1],
	[2, 2, 4]
], [
	[1, [2, 3, 4]],
	[5, [6, 7]],
	[8, [9]],
	// 1,1,1
	[10, [11]],
	[11, [12]],
	[12, [13]],
	// 2,2,4
	[20, [30, 40]],
	[22, [34, 44]]
]);

let next = decode_payload(base64(enc.compressed()));

console.log(read_mapped_table(next));