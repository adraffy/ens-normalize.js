import {bit_array, bytes_from_bits, bit_width} from './compress-utils.js';

export function encode2(v) {
	let ret = [];
	for (let x of v) {
		let w = bit_width(x);
		if (w <= 2) {
			ret.push(0, ...bit_array(x, 2));
		} else if (w <= 4) {
			ret.push(1, 0, ...bit_array(x, 4));
		} else {
			ret.push(1, 1, ...bit_array(x, 8));
		}
	}
	while (ret.length & 7) ret.push(1);
	return bytes_from_bits(ret);
}

export function decode2(v) {
	let buf = 0;
	let n = 0;
	let ret = [];
	next: for (let x of v) {
		buf = (buf << 8) | x;
		n += 8;
		while (n >= 3) {
			switch ((buf >> (n - 2)) & 3) { // upper 2 bits
				case 3:
					if (n < 10) continue next;
					ret.push((buf >> (n -= 10)) & 255);
					continue;
				case 2: 
					if (n < 6) continue next;
					ret.push((buf >> (n -= 6)) & 15);
					continue;
				default:
					ret.push((buf >> (n -= 3)) & 3); 
			}
		}
	}
	return ret;
}
