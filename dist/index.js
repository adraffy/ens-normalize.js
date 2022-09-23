function decode_arithmetic(bytes) {
	let pos = 0;
	function u16() { return (bytes[pos++] << 8) | bytes[pos++]; }
	
	// decode the frequency table
	let symbol_count = u16();
	let total = 1;
	let acc = [0, 1]; // first symbol has frequency 1
	for (let i = 1; i < symbol_count; i++) {
		acc.push(total += u16());
	}

	// skip the sized-payload that the last 3 symbols index into
	let skip = u16();
	let pos_payload = pos;
	pos += skip;

	let read_width = 0;
	let read_buffer = 0; 
	function read_bit() {
		if (read_width == 0) {
			// this will read beyond end of buffer
			// but (undefined|0) => zero pad
			read_buffer = (read_buffer << 8) | bytes[pos++];
			read_width = 8;
		}
		return (read_buffer >> --read_width) & 1;
	}

	const N = 31;
	const FULL = 2**N;
	const HALF = FULL >>> 1;
	const QRTR = HALF >> 1;
	const MASK = FULL - 1;

	// fill register
	let register = 0;
	for (let i = 0; i < N; i++) register = (register << 1) | read_bit();

	let symbols = [];
	let low = 0;
	let range = FULL; // treat like a float
	while (true) {
		let value = Math.floor((((register - low + 1) * total) - 1) / range);
		let start = 0;
		let end = symbol_count;
		while (end - start > 1) { // binary search
			let mid = (start + end) >>> 1;
			if (value < acc[mid]) {
				end = mid;
			} else {
				start = mid;
			}
		}
		if (start == 0) break; // first symbol is end mark
		symbols.push(start);
		let a = low + Math.floor(range * acc[start]   / total);
		let b = low + Math.floor(range * acc[start+1] / total) - 1;
		while (((a ^ b) & HALF) == 0) {
			register = (register << 1) & MASK | read_bit();
			a = (a << 1) & MASK;
			b = (b << 1) & MASK | 1;
		}
		while (a & ~b & QRTR) {
			register = (register & HALF) | ((register << 1) & (MASK >>> 1)) | read_bit();
			a = (a << 1) ^ HALF;
			b = ((b ^ HALF) << 1) | HALF | 1;
		}
		low = a;
		range = 1 + b - a;
	}
	let offset = symbol_count - 4;
	return symbols.map(x => { // index into payload
		switch (x - offset) {
			case 3: return offset + 0x10100 + ((bytes[pos_payload++] << 16) | (bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 2: return offset + 0x100 + ((bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 1: return offset + bytes[pos_payload++];
			default: return x - 1;
		}
	});
}	

// returns an iterator which returns the next symbol
function read_payload(v) {
	let pos = 0;
	return () => v[pos++];
}
function read_compressed_payload(s) {	
	return read_payload(decode_arithmetic(unsafe_atob(s)));
}

// unsafe in the sense:
// expected well-formed Base64 w/o padding 
function unsafe_atob(s) {
	let lookup = [];
	[...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].forEach((c, i) => lookup[c.charCodeAt(0)] = i);
	let n = s.length;
	let ret = new Uint8Array((6 * n) >> 3);
	for (let i = 0, pos = 0, width = 0, carry = 0; i < n; i++) {
		carry = (carry << 6) | lookup[s.charCodeAt(i)];
		width += 6;
		if (width >= 8) {
			ret[pos++] = (carry >> (width -= 8));
		}
	}
	return ret;
}

// eg. [0,1,2,3...] => [0,-1,1,-2,...]
function signed(i) { 
	return (i & 1) ? (~i >> 1) : (i >> 1);
}

function read_counts(n, next) {
	let v = Array(n);
	for (let i = 0; i < n; i++) v[i] = 1 + next();
	return v;
}

function read_ascending(n, next) {
	let v = Array(n);
	for (let i = 0, x = -1; i < n; i++) v[i] = x += 1 + next();
	return v;
}

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// return unsorted? unique array 
function read_member_array(next, lookup) {
	let v = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < vN[i]; j++) {
			v.push(vX[i] + j);
		}
	}
	return lookup ? v.map(x => lookup[x]) : v;
}

// returns map of x => ys
function read_mapped(next) {
	let ret = [];
	while (true) {
		let w = next();
		if (w == 0) break;
		ret.push(read_linear_table(w, next));
	}
	while (true) {
		let w = next() - 1;
		if (w < 0) break;
		ret.push(read_replacement_table(w, next));
	}
	return ret.flat();
}

// read until next is falsy
// return array of read values
function read_array_while(next) {
	let v = [];
	while (true) {
		let x = next();
		if (!x) break;
		v.push(x);
	}
	return v;
}

// read w columns of length n
// return as n rows of length w
function read_transposed(n, w, next) {
	let m = Array(n).fill().map(() => []);
	for (let i = 0; i < w; i++) {
		read_deltas(n, next).forEach((x, j) => m[j].push(x));
	}
	return m;
}
 
// returns [[x, ys], [x+dx, ys+dy], [x+2*dx, ys+2*dy], ...]
// where dx/dy = steps, n = run size, w = length of y
function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let vN = read_array_while(next);
	let m = read_transposed(vN.length, 1+w, next);
	return m.flatMap((v, i) => {
		let [x, ...ys] = v;
		return Array(vN[i]).fill().map((_, j) => {
			let j_dy = j * dy;
			return [x + j * dx, ys.map(y => y + j_dy)];
		});
	});
}

// return [[x, ys...], ...]
// where w = length of y
function read_replacement_table(w, next) { 
	let n = 1 + next();
	let m = read_transposed(n, 1+w, next);
	return m.map(v => [v[0], v.slice(1)]);
}

function read_emoji_trie(next) {
	let sorted = read_member_array(next).sort((a, b) => a - b);
	return read();
	function read() {
		let branches = [];
		while (true) {
			let keys = read_member_array(next, sorted);
			if (keys.length == 0) break;
			branches.push({set: new Set(keys), node: read()});
		}
		branches.sort((a, b) => b.set.size - a.set.size); // sort by likelihood
		let temp = next();
		let valid = temp % 3;
		temp = (temp / 3)|0;
		let fe0f = !!(temp & 1);
		temp >>= 1;
		let save = temp == 1;
		let check = temp == 2;
		return {branches, valid, fe0f, save, check};
	}
}

// created 2022-09-23T10:53:59.182Z
var r$1 = read_compressed_payload('AEQFtwQADFgBGQJeAIoBawB8APgAfgCfAGQAugBKAIoAXwCDAEMAVAAgAGgALAA1AB4ALAAdAF0AFgAsABoANAArADkAFgAmABcAMQASADAAEAAfABEAKgAUACUAIQA5ADgAMwAtAD0AFQBDABUAHgATABkAEQAcABIAGQALABEAFwSvBaoA5RKyARUMEqMfKBgBlQATGjM2DkUotmRtAaMnBT8AuwCshTJnswJIFgcEA4wCAYYBB3KBR1D3vAFwYwHsAo4A0EfCCAiEACUDCwLCATWQQS35AS8M7x8AyB3HEFLHARABswAUAykJEAxKGBsyCjwBjyOoBCABPx8fDwEPOzIqBpQiD3sGJ2tEBP8N/5YpJVgsDgAiFyNKDxcAd29PAFwhASINPg4+FSpvIQIASgBLfgB6PxhvHzcmBP9fDyAfFn/vDBEgLE8cbwMPj38PDx8Pvxb/QQLALwnPLwL/Dn8ivwD/EQ8Bol8OEBa/A78hrwAPCU8vESNvvwV/HwNfAVoDHpqZAAEAzwHPhhoB0k8Ars8vIYSBMRQADBs1OkQPvx9fUwMrpb8O/58VTzAPEg8gFBokCTRfIacCFQE+GBgFADMmaUOVJiQoEhUdA29MABsZBTMNJipjOhc19gcIDR8bBAcSCAJaLoMiAu8BBgD4EAUKFrcDleIASyoztQUWAUuEAyM2HhNSpZ8O+Z0VQRvwEgoPH20BYRN/BrsU3VoWy+S0vV8LQx+vN8gF2AC2A6oTwACUWgFsAKYGAypgAK6ENDQ0NAE/jgoO8AACB0QG6TYFXAVdLQA9njkF9s8WAwvNxgv9CqoDzZ4EAsoKNAKOpgKG3T+Tb44CxdACg/cBJMoOAPDoAIoBRgIykgomlFoATgDnCiYAHNm+zREQQqIAIhAB3lB0AQICPhjCD/AapjYBWABgANi8CgIYAS5sCgPCB6y8BjYAsABulu+qnIQAYASmBAAmAAbuACAAQAKaCFoXAKoAykAPNA/2CMAuA7YAFAAA9zJwqACmgh0AHAF8KKwAGgBPAGoBIgC+GdIE/xof8QJ4ApcCrjQ2OAMFPAVhBToBezegAGAAPhc2CZwJjV4KXm0gH1a+UqGgyoNHABgAEQAaABNwWQAmABMATPMa3T34ADldyprmM1M2XociUQgNCgBdPfEAGAARABoAE3AgYUCcAMPwACAAPgEElbNoJwgBEv4WwKoAAdq9BWAF5wbAAshwAsS1AApRIaRqFHgackz6AMAoHgwIlABAkNAULi/AACAIAGwiF5yW8WpAAAROviIAzEgBEyAAwigeDAgCfQTSkNAULgeHOegIvjYLT/iW8WpAAAROAEknBgIDLgAGHg7GADwkEJgQfh5GAeAoEVwCNh4EyA/AAAgGAHgAPDoaGpDmAfoqAMwNgqq6ABAMRGhOkOYKAAoA5hAAZgQFhpnuTgUg2nAcDfoAmITWAaYPvBnqA6AAbAEKHj7yPi8FdgXVPODXAoAAV2K4AFEAXABdAGwAbwB2AGsAdgBvAIQAcSR/FDR14lMkUxEAA1RYUwcAQwDSCwKnAs4C0wKUAq0C+rwADAC/ADy4TQSpBOoJRikwBlscfDr4N2EgHQbKAEKQAEqTyscBtgGbAigCJTgCN/8CrgKjAIAA0gKHOBo0GwKxOB44NwVeuAKVAp0CpAKrArI07DR7HzTwNIsbAFk1ojgDBTw0EgCgNgk2BDZHNlA2TTZWNhk28Jk9XTI3QkEoAoICoQKwAqcAQAAxBV4FXbS9BW47YkIXP1ciUqs05DS/FwABUwJW11e6nFkn1gBmZKH9EBgDygwq9nwoBKhQAlhYAnogsCwBlKiqOmADShwEiGYOANYABrBENCgABy4CPmIAcAFmJHYAiCIeAJoBTrwALG4cAbTKAzwyJkgCWAF0XgZqAmoA9k4cAy4GCgBORgCwAGIAeAAwugYM+PQekoQEAA4mAC4AuCBMAdYB4AwQNgA9pV6KRR6k5yG6AA8AFgA5AEIAPTh3ftjFEGQQYQYDTQ5McT8VEAKxD6sL6hEaDNYq0NPdADSuB/ADWAfwA1gDWAfwB/ADWAfwA1gDWANYA1gcD/Af2MUQZA9NBHIFkwWQBNsIiCZOEYYHLQjXVBJ0IxxMA0oBASMqSSE7mDMQJUdMEU0ICAE2R2ysfT0DTDGwVPqQpwPQMlQ5cQYDHnYSpQAvD3ghNbpOg3pMcaUKUE+zV/cARQYAEqsAEuYASQ0oAFAsBj0ASOM02AATRgBNmwBNygBMXRgASmgG4ABQVwBQjgBQSQASNklnTmwCwzqtP/0KJgmYb8B3UwZCEBwnphD4DDQBtgE8De5L2QTyBjwEyh9+GRoPzpWdCKYt3gzuJuQuooBbI/YqhAXuS/U83gtOUWkPWgtmCeQ6ZIFPAyIBDiKMCt4NOghuEPQKymwN5hFGBzoD1kmbAKYHAgsSHTYVtiYRYq0LCjl4Bvwa9wuQJrATKnr9BdQaIgZOASobAADQLuiFsVoyXB1PYAYECyYjyBSpUCENJkC4eEkaHAcWJaoCkkNxSohRNx6UIfc8Pg1nLhRRfQf2PAYZUAuCPJ9GrEUPEdM+jj1JIkpMLQQ2gCwwJ4wJ0A+GDLp8cwFaCSIJsgxyEzIRGDfGCDoHGi6XJScWCCJGlmCbBPigA/QT0gMMBUAJQgcUA7YcLhMvFSoFDoEl2AL0NtYutAKQVoEBGAXMDyYf4BBRR+EO6gicAmYDhCXsAC4VIgAYIpwIRGQAYI/ZUwYuzAjIam0jdQNoFOhiEXQHkg5YB6gcNBXAHOJwyV4MhgkopLAJXAF2CZoBYATkCAo1XIyhIEJnVItZGJwgYkFAXf0CMgxmFaBEvod5AowPbBIcATYBdAc6DQICeBHuEWwQlgjshgU1tjP5OiYEUCGEIBIKKANQbM8LKCb6DPlqAaQSYwMNND5372esYLclF/4HGjLGQWEh8guTT84MnRrCGENULxnlB8AD9Br0J+tBWAYAA6QEFDpOM+8EvgtqCIwJQABKDqQYB9gYawpyjNEBMowBuJoDWJKEAnCQBjgHDABoDIgFeuYAHgKoCKQABgDQA1gAOgKuB54AGgCGQgE+AygwASLmApADlAgyzAGWMAH0KgQcxAwWAPg4bksCw7ICgGtmowXeWQKPAko2AU4mBAZPSFIDsHLiANwATAYU4EgBFqxLzBvkRAHgcCwAyAD8AAY2BwZCAc4B9G4AuAFgCzIJo7S2AU7qKgCEABZsAdgCigDeADYAgPIBVABOBVr6BdQCUEoBEjIZLFhiAbwDIAE0AQ4AegbMjqbKCCAEbgfUAhAcFeIC7y8HtgIDIuATzkLGAr3fVgAyFwo5CqgKp2BcYTQHMnM9UQAPH6k+yD5FAiZLAFDmAFBDNJo1MVZJNgGnAaopArfwAW2rAEj/ArfuAretArewArrbzQLSArfcArfPEABQQgBQP1KSUoMCt6QCvDkFUjteO1k7XjtZO147WTteO1k7XjtZ1gBDPABCH8XiMwDbYDVYAEIMAEH/AbYoWCNNwFVNKCapCm1fRmHsDKcN1UTJOkoT3GBSYDMTyS24FMIVzyVXGT4avScGJeVVCg8FLdRmMQgtNHYXvQBAKWmDQmOHHjEKTBzoU5JU+S0cALJLozOwDa0bFkRBBUh17mIrFg8KIwJkggJiQ1xOsFw3IQKh+AJomQJmCgKfhTgcDAJmPAJmJwRvBIADfxQDfpM5Bzl4GDmDOiQkAmweAjI3OAsCbcgCba/wiwA0aEYsAWgA3wDiAEsGB5kMjgD/DMMADrYCdzACdqNAAnlMRAJ4ux5d3EWvRvQCfEACeskCfQoCfPFIAUh+ZCUALBZJWUpcFhhKzQLRAgLQzUsoA4hQA4fnRMaRMwLyol0EAwOvS89MLiYE0E1NTbACi0ACitnCHAgeRGgGuAKOOAKOXUGYggKO2gKOXXlRtVM2C1LVVIYCk/wCkw0A6gAdVR9VsFXRBywcKZaHMuJ4Z0U8OgKXoALvs1giqQBaJgKWkAKWfZ0AqlmtWgqCTgA8Apa2ApZPXEVc0gKZzAKZZVzLXQgaApycOcM6ngKcFwKfnAKeuYsAHhAyKxACnfICnpMAtj5hNWHwAp7UAqBvAaoCnqAgAp5PpmPJZCgmLAInsAImfwKg/AKgTdgCpjACpc8CqAAAfgKn82h9aLIABEpqHWrSAqzkAqyvAq1oAq0DAlceAlXdArHi2AMfT2yYArK+DgKy6Rhs4W1kbUlgAyXOArZdPEBukQMpRgK4XwK5SBYCuSt4cDdw4gK9GgMtswMyEgK+iXIDAzNyAr4bcyNzUALDzALDBXODdEw2RnThAzyoAzybAz3AAsV9AsZIAsYRigLIalICyEUCyVACyS8CZJ4C3dN4emJ4r3kmS9EDGKRnAwJh9Rn0lSV7DF6TXrwSAs9sAs9tMExU0/QUoADHrgLPdAEq6wNOE35MBgLcKALbiwLSUANSXQNTYAECA1WNgIpAAcwX7mFGdgCCz4OOAtrIAtnfhBGESqc9A4amADADZA+Gclr6AFYC32YC3rl0eALiMO0VAfMxKAH0nAHy04gC6/QC6XF6AALq+gLq5QD6SAG6Au6KAuudlquXBALuQAOF4Zh6cOFxogLzBABqA44XmZQC9xQDkW8DkogC95kC+doC+GeaHZqsvDibHwOdhAL++wEcADqfHZ+0AwWOA6ZrA6baANLGAwZroYmiBgoDDEoBOwEgBzwAnASAumgGALwEbMASjB0iAIQMABh2OgAkAzSwA8IQ2IABZCgiAIzw3AYBLACkfng9ogigkgNmBBIARAK+uQRWpMYDAKwFFsAD7hx9O9o+Nj021DbJNkY2OTbwNt02SjYlNxA3GQVtPENFMEImQrlfbhZfwQCWygU3AJBRHpu+OytgNxa61A40GMsYjsn7BVwFXQVcBV0FaAVdBVwFXQVcBV0FXAVdBVwFXUsaCNyKAK4AAQUHBwKU7oICoW1e7jAEzgPxCOgApARQwMAAwASswADsGK0DVQVMBUs+bj51QkRCu190PF/tAFgWM7AAjQPMcMwBpuxGf0IrKAkwGyw7On5y32/B9hnHLG4BcNdzNRwFZAVvycbJvQjUTvBPBQw9BQUMPRZHApTmAqDBXoKQzQA4P4YACB8AsigKAIzIA1gSAOUiCACkIkIpJE9CtkI7PShfLGA7LB8oCkgDUn5eB14IP0g+fT6GPnU+dgKOQjNHQF/QU1RvUg8xcFk0AG8QcyRf5ThCEEIJQgpCiSAKTAphzDgxBcYYuikgG4snyEazI7QoMEEiK0KwQlHMBswBX84TJDMODQ4BBAQnfqLfbz8yT0DJsMmxCnLQ0VJYXf1d/kFkD+oQqBYAkxgiSkIqG65tPs49Ckg/SD51QkQcDA8iUUxxYDEyWua8F0IkNmHyIjBCRBxiDU8OEzhZSEc8CTtInDEKciAyQkQb+g1YJygdNTYFCo9m8GMzKgqAZM5wYBBfs2AyKHMESF/jYB4+ByAjX4dguAsHcBVqUxv5YFIWBgMEX79k7PJgGl81YJpf12CCX7lguByNYFBfaWCWYDEBzkhRmQBVJRgMISttEBgyYgV2agIrB810nXOSEygrZACNDgbXB0t0azAA8xAHAEslCKsFAiURjHwAOJRLRTMuAS8BOAJVbUqRCRIEHSCdBh97wyVx4xFvCwUvOyrrATgC+joABhYAECoCGw0WES1ZEhIDCIID8JYLHuoAyjwBWxATJLcXBBYCAJQyFioBuUTzCqFfQBxYQp8vIRaIsMcU5TCVBZ107gGncz3KE5bqLJUAkBM2iq0bQkYOBQCWwqlB+gCTE0/xgxVC9TEAywUcHHM1Ly4DFQDLkFIAzZBJAWkhOWYApg0ZB04AwaMGNQd7SZAgVAEDAHEQAJAAkADFKif9MQA0sB6ilQHMAOkLAlDRefC0in4AXAEOA6PjCwc0IamOANMMCAECRQDFNQAuBgd+CyVED6vr6AsEMQUGfBQFeA0BGwC17y3wA3YDcwN1A3gDdgN8A3kDdAN6A3wDewN3A3kDfAAOAsIANAYAOQFXAGANAGAAgwBgAF4AXgBfAF5X8UoAswDDAGAAXgBeAF8AXgD0DQBg9ACDAGD0AicAYPRX8UoAswDDAABhDQCDAGAAYABeAF4AXwBeAGEAXgBeAF8AXlfxSgCzAMMA9A0AgwBg9ABg9AInAGD0V/FKALMAwwAAZ/QBiwCgAZIAowGTRgLZAicC2VfxSgCzAMMA9A0AgwLZ9ALZ9AInAtn0V/FKALMAwwADa/QDbPSdVm8WAANMAfinjUI19AA2ja06FnQDKhVsJwLm1k/4H1zPWOMfOvQBNQP0ARTX9AABExsBzkhRmekaBgkMIRYvpzIBFQT0OGoAPl1dCCcAEgZ6c53DRkARnEQqwgCNDgOEAepMAAPKFQ0pSXEJCVliAi+QBXMpADiUS0VqRQAjYh0ONw4EDUS0BgBdAlcAgXwaAwdHH50GCnvDJXHoEQANCgAlK48BOAMnOgAGFgCmoitmCnBHKQDkYg2p4yD3PAIgEyS3F/NvrBFpB8iz/gEwUYwdeGOwNrVDl8og7x3rBmdp0W/R8CmX29eRMNVH0zOTPys6OoyQ8rl6zGYB1JPHPcpheaYh07q2kaFgtUgba6IzaQpMvA0vp1YQurdzijdS3/eNA0M52AO3Dn1bAm5OiozHVLJxb6gBjnRXrfC2rqLsO3DV/nTYT1OoMhN1GpZyHMt0vIHrMldcCWmIZT2r24/E3xK3WH2eLhpKTnE+iAIGYviiBaJ6+GGsl1Nn4Fg2dZKIrhrGCAhyernhLQ3X+dkVVosaqNVqbKDvI6j367DXtGYp9Uz3yf3TIINGylvMQs3rRFQbkATcXHxM/5styFeqBvRk6HPP4pHDRGBkM01AK0YaCXGEP0lqmvQPMWvSpsruwr47Ts6JueebXqQZRdhzgXcgiMg1Yavq1596lBsPT1rEiPnl31W/s8qDS5yrTNKmKI/693rzrUqyIEh9qb4XfbAL2ncb3bqS3yY6yCljUSCNMcMi7/kZaOVF9PM/UgTAEXO+Tj6oCVaSkS7Cg/SSzPLxYdWbWpP9CHOAK5mM4EBTvhZ6mtiLQS0cJLaHmY4zO5KuogtLoQJwjcOTTnHvg1LIzYj+0mVkQc0JccLIOwF7/YkpgYhsiJJF03PexpoDCFjoCy1OiSFnU81IUY4Yl1dAtCFoc/95/y2c5IQQUpQo9KzKaHq3uRPoYwcV2tQ3ZOyNUdRGVt+bIozsI05A8LENaXK+lNMVgG+L1w5klCTr75JQZxKC2UBmAtXWvWnCfTI4HOppHoZx3NrBKF9DoACH55v4o60V+eXSY9qOqpE5Oo8NLB+FRQ1z/ZvQ3HPxs9IKbV4clE806+XHROfSItU0K0h3soflSZaqxRVQXF29GybFK0QA3JxHP8ItzXwSuG0WWx9u/jFbKd3jbNxhrBRT+rILlLPwQI0g0pi2Y+XlMct/QWJtBQUYt3CAdrwvYGm599MIrTz1fWUWSYHPy2Yo5CmFeM9+/BUJ0dTyJ7UVQBNLSU/zpdT5vKNS8kMnN054lpVHAeZdAofiYp661GW4h3GfVA6Lf7cF7Lu7NzDYZ7fL58Rmu0HqAMBDzvJGXQGfxFSyUlveTu4Eg0Wka+14rsR7Qyju+LKYrVDgQgBoqM43O26PPQO69hOyGGZaSSxasieVLZTjE5o+eK1hZIDe4YOjOgGcv2pLLajUiy+BtQ766uf5153wcUJt9ZVIt3bG4wNXdEewBy4UAB689QbO2vcGKBrxPo8pubVRa9/n2T+h82Evk2QvSmY23qWGoSFaEqUs/WLZdjEa3kGJgkI1HbFPlXH7HezcbsaiZCFCaMvfenmMkhlJT6Foar2ULU0fMZ/lMh7FpEFeDCpJL2UhEof2MfGpmMSJgvHeX0dr1Wn2NPLm74Tcs7pXEJyRvJ/V9BEpSEfZsa9QgRbSyJJR3f24b/oCtXN9AVF4a8X96vQiDdIt4wc6ikHVZVzxu8ouvxK0ewdgdbrCDUcv6faq+tLowgFcW9oUd07J7ZMUu06eCCPLba1s+eyNE/POpDoyIEpfjrfuPLquY8SsaHA0zO+SALgXjFKWZmP713wTH8Lil1GWImoyaEAOtUCwgsRxajyYhwlv2MKV78odHjWsJRbIBEkPEK9Fiozh7XKvLaXgipaf2FW6FC6B7qZvxyl4lAf1KprLDcZECgILmwpl2mpu75Zy3dJvtErv6z5IO7M+DXGmP7lrnjynFqepm7mQyIxuE07FP/BKBCq957Cu7t0rRkMhe1D64wtkyF9ZcxwQB3sTvaa6OFf5RN3mpUkY8W+U4Hi9W+xSGM5yAJ5VcmjaXhGAUFQnm+gOZso+Ge1R+S1r9k/qUMJ/PgA3835RJ18s/W1qH/gP2k5XfeMmQKy1wJFCT5F2fHlpjldK6kDtOJlk2G6eMLhVJfLW3wrXLHUnqdvq33IEHVGFlyMSsgkc1zKRyAOKdfd+T2Jj+GkH0ySSvbXf8zRt7KdjE2ReCoei4TSG/36ZHjxcOtSNlf7/VSy1jj6qW6VbLstEFZQ0P+QAFrA1FN0yZGR+sResJkg6rGS/JPAX0eoHftxAEbIMSG/yIu7Kc0H7rY6SasR4lHfdUFry80K3jNvkTQxLEydaE/DQS2QZVcu1x6vp/FrvhmVGK80ZR/Rfqxg8TUA1YJxUnRDDC1JaBC8o/4ciMXQv1zs9LCjrjKh9O5ovDQMbz3BomjA0jLvJXrq6C/e5T8l75vz+SL+CVhdb7b8Ur9emRFzp77IU4kaPuSx5gQsV0rFP/1feWtar6V52YNzDjnfJYJIOd+rqjcVwrB2aIZ9MvjtDr22IDbXo14HrMfzJ5J5PxNStdAKxxtKj08zefgz2brZDlfttGn4FgoBGErf9npgZt5uWbDHQo6R9JSkccar0u+lfep64tlicNnyBhUTYH4xZXs0DFxgu+q23LuAirluN4T0+mrZYcS33YcJxqVHzvZy7K0zd3sX9RzU1m6qk+qRIltIQfrHEEknBASjj6zqoUw/JZXEM4WBtXaqT8lLyLcqHzEX7o+BfmZADdCAd1a4KyJG/Hkg5u9gYd71AylBmqocGaw5jgYoH1IpqY45zyN8WXr1k2GP5UzM+T1Tfzk5ve7pn8S3rZxTlyNuq4DPuwmCrq3GPXs1CPQ3pI5yESkeq5qoqFJZkzYFiWa8Al9M/DaFwEaPHW0uvggBmOK/C+7oN6/AhuuUJ4ieiYkDIs66XNMVVa2OFuYXklpnSqRXPsIz/2D+JV7W7dJPIr53RqowvmVVfxlN0HcReMWqtbaxnXxQlBymFeWR4h3dguYDz+DNyL3CDmofiRaS3zxl8C1Eh81xyFi0zXTqDThr7JwGqtSNjWjs7f4f2IAx6m4nWWWvIOSBtJvRqsVVZuaO5g1vb/19U81ES9VcVYaX2E7uG4aIt7524WElIl5EUQJARZA/oMFZf5J8HZ+Ye5P3qJegqcHx3u6fP3dBbZQML6qNZannxu7f2nZLLH+dY/laTBlcMTW0i/uLIIdBiFuWeg4AIFeoKdwhiGJIMPFJ5rKS2TS1v5VpfilSKkkhYwOyiDWFw4RwL5SVE/2OCIntblcJyDnhWCY0P1NVokXT12cOZShOWSXZOr+na5vySaLY8R17wd2zXhFxx2+VulcwwKkgimNqByjL76jYVnwtJd/lyRvXyhVb39LmXJNQeBvjnydZ1TFIQPcZ2eBpUpR3/JY6uKbZleFW1ekf5/eTiHm3dJvi4b1zWVYiqcqosqLf75VXlKvYpgkwzY63shGziDE0XUTFZWmjjWb9mOUAogf146BwmyXuyKCEyrKDjhzsxcmskFwDLBwD5jmoyBp6XymX5o75Tu547NTo5baUbb60ZH4VFnH2YwXebeqJD42ZmBuCXb8ckhiuKKK8rOzY7vEwN3C5PA8x5etq0ccCO0eX472dpPpq+QDS8Qoo5MjACvJf2m4ndabkQ9QiKO8RIoY/ryh9fMO5s2pSgMA6HwQ+AbXOE+wMmAwKYZmg2C/N9p27HVGfa6W7ksNqm0Jr+sVDpmncVox5lDgxCFAVzfQOxnTbX7HD5prqdBttQSaVkcEA5GRN3/yJsg66nLWRUuGEiGyYZ9T6OTdbMdT0msv7+M90wTpdmV+qNfPQKOgPWp1lKFrdfYgsRroaKxUVfUwpuejLPYQyHlv0yXnnkE630mIZsP6IS+hlSdq0esiZSIA/pKwcLzvgeFXh6BpxnVFWBH5LFwN/2jBUBCd2ArMnNBOBr+SMvT9JOBOY0R/LHtx8XShO9qXXd7VNEJKNIPynptKJgM7ZSlbWUluc000OkP01Ya563yoGVYRWS1fxfFex7Eak3FL1iWHYNatwB56qGesPF9XSuwYvkxwdxyJtssPIisWT5JxUW1yl24rTHaA5cq5olUjN7deGwq8JCm+sjTAvZFzvPrwok2xWMOGiS9rtpzmVJw57c8Fs1OVjWiQ1JXWSSjofSBWV8cVb34ApZ1r644mSNPVAcPZKbeqSzEcABJzsticzb4kr5AKU46rdFxwYIyiV9LlBIQ5xdaWtMbTV0dLyJ1leW2pGrdhIKMepVgIhwW3LFnEjv6QlxSjfFDrHXtm9CIV+FOlR3/PMSUOalhoHpDlf2yavz8dYf8yNm3LRGysDyt/fppRvbbboDlujBh4hxfjSOsdAx0jVUmmhKaWIpf7DZLyQ/owrnAA0881UH1fbA6ny+5lz/gP/UgvngsRbcQ+CreyDdD/E7SBua2K/QKq/0RGHmGzPNHQf4wxU1alt69yTRo4PFMeba8rVQ8k9LdlB5hImNF7DgP16ACUNrKEcn5kmPwVfAVoF2FiAN0UPqkWhi5qE0AxGW/CUIq/lZLHdsT0c+v9Vho9HU6qzTcXfIAmWrToeR5N0CNK8Yw6TcBpPESdBcIxmN2HaabbKKSa01ZV6FUuM5WRIHDnV9cPCY8i2ELpL2dFCgWLP6gQjh73xiLvRS//XlLXR7T3+1f2jcY6DGo8JdA24VfKP9YShP6Nq47q+WrczCzeC6JHrkuaM2OO39f5hQ3oI7YkA0eddAR9qx0586ql398e7JRVhbCzWdf///zDgFpSHQBrT+LKmNTCLlNC/q0uJU1sJoo/6MC8BkaSQEey5b/PaRIJUTDgTgnIabvYkRjtNjmD0esub+FDz1LfX7Eqo2g/uNsioz5xxcYdbIpU8IhNPB/Gu9h1TIdbzZhWj1lXfuaaxqN2ln2ss7i7F28zSDFqIpEVStvOmWre1xan2tgN11Fc+DwzYhO8gYNblfeH1NBRdq1qvJZ5FnylAmkWybSpyg2WxtHNgbodYe3Ydwo1gWlzVfNKNfLEEV7IjpWD6ldlVgssa5EgCy9TJ+pI30/XijmQZ/to40OOoXYlj44dOv1WXw1UlHeatC1yFevof3DX1aMNL5yYLdn9Vg7qhQ7LH9zGV6hd7dnNkEViuFrTuW/qo7L8tpn2tExrSGdUDLHItvFQEyOf8Lmooo/R/ddC+rwMpoKYnoAyatVfeSwDsbm2tWwJHvqNZxRwoB+p2r4Ak+s//8ALUHThFk4MrGqqzNFheXV/tnNDMq70udIA9pB4e0Qj3Qb/7ggrUiqj/wS5xoLkGqz11XgMpe6jJ5wllQSLQwdFPc0TLGjh4izyYcKshNizlMucorEHM1ZWq1EJeIFWQEixjq5lv+8XUepWIH+fFUQLFX/9kKzUr0+k1CJe+e3F81NxSb80VJ1VvbChwysmSSxPvYx9bbTdWty5wpcqKCmR8h/4XR3PDtA0Vg8YmYDFxuMqR3NGlf+uI15siTb1XFfB4wtCldSWQUSunDxfyu9Vtx1qAGG6Iau8y1CsPgkS+JI8sKLboLB4CVobOvsITttFZ4qN7mSXm9gV/JJ8JGAhCAyY9jUXg1FC6GYmdRKNOWLZXKqL1KC/S6jrcOEmsa5BICptAEURm0FArOztS1FGIZgF2OqiSMP8SSDU+ZnEuYZh4/XuhzMu3kykDbs1Gb1M184Ja50A6gSV/vm26ZHqoWvPqADz+IBP8ZAVXW/ug0qP6DQxiRhh0G/zsbFkE3/3R6XzkMaKT9nLUC6gVRk7J7xean9YFCBZfZGK17XXCoiOSnLNThaPpMrg6Q/kt/ouWWwgSJE9NymUi9KG+4s/AE0ikJ92MH29nLDtVIWeF5dz/pAKnA8mFX5ttpMbOlH2K/84DSs5xojnxLMYYhYIpbQpYtrwFvtVlf2IkYxPLL0QQsCr5ffwaVH0uz+7tO1GQ7ZO9qncuBnv5+uJLrgzkRSd3A+SMxR62sRe2lTP0HSJ59j2BMi2o0TQVCXwatPTPv7B2CDxWXawiUxVk08C6yvyinruvlMUBNh7UEavZAIAvz0+Ioja6IkXRcqB3DqETuq9m8glhA+Ks4rfcyHdCkeyo5s3ctt7w5wFxTTRpFimBBE4MtqEpiZFqFkWzy61BoQWjjNoF/ZOyD3Oc3RjWO3eY/G2/ZL8NPwhrpxGkXC79/WdK9CdSc9Vw6daiBPUGwaZ/KRjlU3Z0L85wC+JU3xPJkHe170jNTvM1GODhtnC63xiwnFyCQuI7wlvrOqmYTwIXAS33uuKX6gnF9to754XIF5wFyQR9AMtWgdWTrBYu7iMA/If6vffHUkh43Zi/XsiidRclwJZloEpWGP45ngsznCsJdX6R4nfOtLId96sKX1j0r7I7F+XLZv/gNprUeYOoMRLtn/6deN6JlhJIdRFIWGgMDVKEbSNCpBwkKFUN8Nr2GJvC/P3jgPv7hEc/fAV8HSURSMiHwuufoImWj8fJl3cfTvbHyXduJvv5T0b89ZjwarhQRYIXEhzJmCTh61nn9/OSM50Z7L3cjZv4/6wnz3o+4X1v+oBrnJLnz6kmL7HeSAn863Wv574p6xY6PhzUMQVI5FwNGnICeyCs95/Y/XR+9dkvI3eOOnz5maC/theroJNPmDHKvTgwpdr43Bg+6yArSR9CEBvSUOw4ktqIUUh2A7Qz3o3SwgUl4/2q8qA1440/kVQTzspPsZ+lMea57L00Q1inKrwZZi+M5MjxrdJDh+OGhBPkbMO5Da7HE9tgrl529ClX1yXBehVGZAd7V91Y4pBxTwOUPilhQySOYC0c16rpN215u8qJN5Zr1DkhI16XcFpMqfPLP6UpWA1sR8lYl44zmIKuqTFvElIMd5vQVHWNHeDTOfjOCtdw4/H0r4gTUDti6Q1q3j+Kq4n2Z45qflQNtmU3mL0dfIv5Pj2Svac1EKsz7TLM/Y5bbSNg+Eof8E5qCEYAYxjgY9OQ5Ek9Dnu3hCWzQkI5QWV3YdOuCda75cr13+xbqDGjyKFkhuo32btT8khHEv66nqeS10S8ov3QwQAfLYWYtOd+iBtNqzz84Qg+Y3SGRkUUXO8yl0jrx/dEPRLpVQR+hppyEUk90G2LTOeHnU3lxlCXzH5ghGkA1cV8V4AQoP6C0O3rl19XazPiPMTd6a2Rgx9hA3uK3meTvZ/c8GsuPFUq5DUG+fIutTRQhtu6E4qkR/qPu4fbE7YCIjkutntn7lJ9MYrRajQPx3u/zUqCXpw796kIw/E2/F0TPDL1nlKuqXblpoznI10dbYVvS5cy7+P1HvYPxU6/AyhB/SnJSZqFpXD0HNXk+a7YRbCU+26eYhL8og+7LWsGzUT75SLPiZ0g5yXsOxaRcYJe8rjHLJ1xYbuR/8/DmbMdKV5IcMY5zqTRw3fa5WrsfEAqto2lFwbz8tJ6Yy6POjFe8bH4PpVr5hw7hiRpO3l6jUNIk5f6A+ps15beQpbLCHx18ijgH0ss1xsfcoogr7H6z+7aPWbkcHiY72zEdGmpOSfXG/5lNGNts3rYiouDysZe9xLz9vqBMlh98C2rI8+UJBVk/pcUO2gPuC87cFamBG0JD2tHVpwCtbHO1k0WKlXh92OqZWl2lkVzu1AoIt46+f4Xb9+pQEM6aoCPVHsMEjhDhGlTdsT8sYIpDshCoWdHp1yN7cKwdv6aFySIfwXhXK33HlZHBGd9m4/n0cNelOVKlolZQ2ANiGZ/UvoN3CD3h+OGFpPJ6Pn+0xGTLohsemR7jYzx8dvR/aN1Q2f98gO0ERiYDwrJvBkKqDU/cS9NX1WVHBaUuqZp1xkscJ+FzkrwIpMZ6Q4AUWV36+y7XanhhZ/sv3zslHCnWosK5mJUh5y983rm3Yj3/tMFYJ0p1/tl+uIS0xE49Q6+pcfg8Bu2DgHQgKtNiKzeGBhmfpLsCXAZXf5AvJJEGGaG9duhIhiBBeTz0u29Dw/nrXwuKgKGAwKh2ZD2LX+NVPj8lq4BEOSvL2n+fUSit/hMR2LiZBJMKFMee/A1Qrx6zhzE+iD/Ogec9n3/gbsSjE06oYD7hdw0TQtOw+ztKol6jJZ44pL4rld4Fctxi/gRpvW+WRwWWzwtFlsuFeSCEF5YT8xnGp0Vw7CxnXenJhgFCr0f9dT/CJlakAl4T+AApksr2olZdE4d30bOrOnccz8EglGcX9M8CFKKXKd7YjqlhMi/9uFyF/KZYchz0ENIZaGgqk1oBqYFQAYE59xYpP2o/1VrDm2MW42/KsjjAS3ph5RHkhWbQba5Xxe8E7w4GckiN/awgjUODVRouHgo8LMvvSA8PNJXgJHnjp0BPfV4KleHjoTGhTwtg1oDSkYNgu8TpErfxRW6E+Uv++EZKJms0+7/QDr7iLHJQ7O5P96+GjrgQ30cB6NH2L8SxZXuXokortPDts8n0pJjC5OMK39z4uT2l+G2IXpec0YcjPNDxWEutfBWe3cuQsLGJrVakRu8pF8RHnLY4uTGJemOrIOPGasf5Tm8+C8VqNCrLq4CORAGGF/F6SPcY92ol7gwOt8kUzPyj/Ro2lJlGc9OIotslD+H8XBXkYjCcMYAH4vZJ1tSE8+ioWNwQIp6NX1B5gjvMQyQo7nAEM1xzIHCiqOhjj833E0kPRrUgcwm/d0JpSnw6eWoqmqTiWVRqtwxCuexIVf8FvXX9rNgErPBpnS1iFTqgzFWqI6Ox8EmvJ3/3zM+5Rqbx6MoH2Oxo/64fp2EDOPjfyQ10RNAGXAE5OHrxKHwbW76I9fuhB8lAl6s8ZbFnnyNPlvEKYyB1Dhh7nXLHLB4QaRNc1fSrMGyxPF2jOHcxt1YLQHkMVHNu9+HLRTOyOJDNbNsP/GjULgDrXXWri5tpDjMyYhlCu2aFmWo7tvPKAzGjkP3voRzDIj8sUgzURpSV8/D5kgIln9lq7p405FcESUdwgTYBBJCGFiydoXgGcNJ97cNBUnniRb0av5K5g/LP5CdPIq0lpijHPDhTaXOtl0UID2tEj/15rTT8Z3Aog37NivCZNF9fOCMh8/Tpl9d+SnzAi0zMZcIKsgJEmGDoukiUnxZX8tRVaJJ8lkXs1aVAQlzljVw32hJkRQyoGTwSIBDFrd60JYfWtpChDBGt2Ar9euWaSt4g8++bp28D6KQCKMishxfOG01U3kQ7v7iYzqBBDIVMmilAKGYdp1Ier0gkj0AWQc3UUIaLIi2L8jxbXHXXtFkRcCVS52om7qcVDxEaQX4FXR5ENhLDAOjnsvTgBgLDvtyYOqaGdlQrpmpVqdqCRIa91kjN+BK3dl/FCmJ9NSY7UAhkXXeeXX32kRhYKJ9XYKkDPzIYg03xwo/0CFpJbVqsH7820MkM5Cpn2UghugBIsmvvNh6LTyn4tv8hXSKfOHG8i7K/8OBS+c5jAT9ohmrM6HUW4cTzmGw9gF/qnIcyL9bDD38+J40aCMdpPtWdYeQ7ZqdbDuq8sbMQeGb+8tQ251mrdUYPG9AovHSNZT98Or9m7jJc');

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

function str_from_cps(cps) {
	return String.fromCodePoint(...cps);
}

// created 2022-09-23T10:53:59.215Z
var r = read_compressed_payload('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');

// https://unicode.org/reports/tr15/

function unpack_cc(packed) {
	return (packed >> 24) & 0xFF;
}
function unpack_cp(packed) {
	return packed & 0xFFFFFF;
}

const SHIFTED_RANK = new Map(read_array_while(() => {
	let v = read_member_array(r);
	if (v.length) return v;
}).flatMap((v, i) => v.map(x => [x, (i+1) << 24]))); // pre-shifted

const EXCLUSIONS = new Set(read_member_array(r));
const DECOMP = new Map();
const RECOMP = new Map();
for (let [cp, cps] of read_mapped(r)) {
	if (!EXCLUSIONS.has(cp) && cps.length == 2) {
		let [a, b] = cps;
		let bucket = RECOMP.get(a);
		if (!bucket) {
			bucket = new Map();
			RECOMP.set(a, bucket);
		}
		bucket.set(b, cp);
	}
	DECOMP.set(cp, cps.reverse()); // stored reversed
}

// algorithmic hangul
// https://www.unicode.org/versions/Unicode15.0.0/ch03.pdf (page 144)
const S0 = 0xAC00;
const L0 = 0x1100;
const V0 = 0x1161;
const T0 = 0x11A7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;
const S1 = S0 + S_COUNT;
const L1 = L0 + L_COUNT;
const V1 = V0 + V_COUNT;
const T1 = T0 + T_COUNT;

function is_hangul(cp) {
	return cp >= S0 && cp < S1;
}

function compose_pair(a, b) {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) {
		return S0 + (a - L0) * N_COUNT + (b - V0) * T_COUNT;
	} else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
		return a + (b - T0);
	} else {
		let recomp = RECOMP.get(a);
		if (recomp) {
			recomp = recomp.get(b);
			if (recomp) {
				return recomp;
			}
		}
		return -1;
	}
}

function decomposed(cps) {
	let ret = [];
	let buf = [];
	let check_order = false;
	function add(cp) {
		let cc = SHIFTED_RANK.get(cp);
		if (cc) {
			check_order = true;
			cp |= cc;
		}
		ret.push(cp);
	}
	for (let cp of cps) {
		while (true) {
			if (cp < 0x80) {
				ret.push(cp);
			} else if (is_hangul(cp)) {
				let s_index = cp - S0;
				let l_index = s_index / N_COUNT | 0;
				let v_index = (s_index % N_COUNT) / T_COUNT | 0;
				let t_index = s_index % T_COUNT;
				add(L0 + l_index);
				add(V0 + v_index);
				if (t_index > 0) add(T0 + t_index);
			} else {
				let mapped = DECOMP.get(cp);
				if (mapped) {
					buf.push(...mapped);
				} else {
					add(cp);
				}
			}
			if (!buf.length) break;
			cp = buf.pop();
		}
	}
	if (check_order && ret.length > 1) {
		let prev_cc = unpack_cc(ret[0]);
		for (let i = 1; i < ret.length; i++) {
			let cc = unpack_cc(ret[i]);
			if (cc == 0 || prev_cc <= cc) {
				prev_cc = cc;
				continue;
			}
			let j = i-1;
			while (true) {
				let tmp = ret[j+1];
				ret[j+1] = ret[j];
				ret[j] = tmp;
				if (!j) break;
				prev_cc = unpack_cc(ret[--j]);
				if (prev_cc <= cc) break;
			}
			prev_cc = unpack_cc(ret[i]);
		}
	}
	return ret;
}

function composed_from_decomposed(v) {
	let ret = [];
	let stack = [];
	let prev_cp = -1;
	let prev_cc = 0;
	for (let packed of v) {
		let cc = unpack_cc(packed);
		let cp = unpack_cp(packed);
		if (prev_cp == -1) {
			if (cc == 0) {
				prev_cp = cp;
			} else {
				ret.push(cp);
			}
		} else if (prev_cc > 0 && prev_cc >= cc) {
			if (cc == 0) {
				ret.push(prev_cp, ...stack);
				stack.length = 0;
				prev_cp = cp;
			} else {
				stack.push(cp);
			}
			prev_cc = cc;
		} else {
			let composed = compose_pair(prev_cp, cp);
			if (composed >= 0) {
				prev_cp = composed;
			} else if (prev_cc == 0 && cc == 0) {
				ret.push(prev_cp);
				prev_cp = cp;
			} else {
				stack.push(cp);
				prev_cc = cc;
			}
		}
	}
	if (prev_cp >= 0) {
		ret.push(prev_cp, ...stack);	
	}
	return ret;
}

function nfd(cps) {
	return decomposed(cps).map(unpack_cp);
}

function nfc(cps) {
	return composed_from_decomposed(decomposed(cps));
}

const SORTED_VALID = read_member_array(r$1).sort((a, b) => a - b);
const VALID = new Set(SORTED_VALID);
const IGNORED = new Set(read_member_array(r$1));
const MAPPED = new Map(read_mapped(r$1));
function read_sorted_valid_set() {
	return new Set(read_member_array(r$1, SORTED_VALID));
}
const CM = read_sorted_valid_set();
const ISOLATED = read_sorted_valid_set();
const SCRIPTS = [
	['Latin', read_sorted_valid_set()], // latin gets priority because of ascii
	['Greek', read_sorted_valid_set(), read_sorted_valid_set()],
	['Cyrillic', read_sorted_valid_set(), read_sorted_valid_set()]
];
const EMOJI_SOLO = new Set(read_member_array(r$1));
const EMOJI_ROOT = read_emoji_trie(r$1);
const NFC_CHECK = new Set(read_member_array(r$1, SORTED_VALID));

const STOP = 0x2E;
const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const FE0F = 0xFE0F;

function check_leading_underscore(cps) {
	let i = cps.lastIndexOf(UNDERSCORE);
	while (i > 0) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error(`underscore only allowed at start`);
		}
	}
}

function check_label_extension(cps) {
	if (cps.length >= 4 && cps[2] === HYPHEN && cps[3] === HYPHEN && cps.every(cp => cp < 0x80)) {
		throw new Error(`invalid label extension`);
	}
}

// check that cp is not touching another cp
// optionally disallow leading/trailing
function check_surrounding(cps, cp, name, no_leading, no_trailing) {
	let last = -1;
	if (cps[0] === cp) {
		if (no_leading) throw new Error(`leading ${name}`);
		last = 0;
	}
	while (true) {
		let i = cps.indexOf(cp, last+1);
		if (i == -1) break;
		if (last == i-1) throw new Error(`adjacent ${name}`);
		last = i;
	}
	if (no_trailing && last == cps.length-1) throw new Error(`trailing ${name}`);
}

// ContextO: MIDDLE DOT
// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
// Between 'l' (U+006C) characters only, used to permit the Catalan character ela geminada to be expressed.
function check_middle_dot(cps) {
	let i = 0;
	while (true) {
		i = cps.indexOf(0xB7, i);
		if (i == -1) break;
		if (cps[i-1] !== 0x6C || cps[i+1] !== 0x6C) throw new Error('ContextO: middle dot');
		i += 2;
	}
}

function check_scripts_latin_like(cps) {
	// https://www.unicode.org/reports/tr39/#mixed_script_confusables
	for (let i = 0; i < SCRIPTS.length; i++) {
		let [name, script_set, whole_set] = SCRIPTS[i];
		if (cps.some(cp => script_set.has(cp))) {
			for (let j = i + 1; j < SCRIPTS.length; j++) {
				let [name_j, set_j] = SCRIPTS[j];
				if (cps.some(cp => set_j.has(cp))) {
					throw new Error(`mixed-script confusable: ${name} + ${name_j}`);
				}
			}
			if (whole_set) { // aka non-latin
				// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
				// if every char matches the script is confusable
				if (cps.every(cp => !script_set.has(cp) || whole_set.has(cp))) {
					throw new Error(`whole-script confusable: ${name}`);
				}
			}
		}
	}
}

// requires decomposed codepoints
function check_cm(cps) {
	for (let i = 0, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			if (i == 0) {
				throw new Error(`leading combining mark`);
			} else if (i == j) {
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i - 2, i + 1))}"`);
			} else {
				let prev = cps[i - 1];
				if (prev == FE0F || ISOLATED.has(prev)) {
					throw new Error(`illegal combining mark`);
				}
			}	
			j = i + 1;
		}
	}
}

function ens_normalize_post_check(norm) {
	for (let label of norm.split('.')) {
		if (!label) throw new Error('Empty label');
		try {
			let cps_nfc = explode_cp(label);
			check_leading_underscore(cps_nfc);
			check_label_extension(cps_nfc);
			check_surrounding(cps_nfc, 0x2019, 'apostrophe', true, true);
			check_middle_dot(cps_nfc);
			check_scripts_latin_like(cps_nfc);
			// replace emoji with single character
			let cps_nfd = nfd(process(label, () => [FE0F])); 
			check_cm(cps_nfd);
		} catch (err) {
			throw new Error(`Invalid label "${label}": ${err.message}`);
		}
	}
	return norm;
}

function ens_normalize_fragment(frag) {
	return str_from_cps(nfc(process(frag, filter_fe0f)));
}

function ens_normalize(name) {
	return ens_normalize_post_check(ens_normalize_fragment(name));
}

// note: does not post_check
// insert 200B between regional indicators so they do not collapse into flags
// alternative solution: only allow valid flags
function ens_beautify(name) {
	return str_from_cps(nfc(process(name, x => x))).replace(/[\u{1F1E6}-\u{1F1FF}]{2,}/gu, s => [...s].join('\u200B'));
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
}

function process(name, emoji_filter) {
	let input = explode_cp(name).reverse(); // flip so we can pop
	let output = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			output.push(...emoji_filter(emoji)); // idea: emoji_filter(emoji, output.length); // provide position to callback
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				output.push(cp);
			} else if (!IGNORED.has(cp)) {
				let cps = MAPPED.get(cp);
				if (cps) {
					output.push(...cps);
				} else {
					throw new Error(`Disallowed codepoint: 0x${hex_cp(cp)}`);
				}
			}
		}
	}
	return output;
}

function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let saved;
	let stack = [];
	let pos = cps.length;
	if (eaten) eaten.length = 0; // clear input buffer (if needed)
	while (pos) {
		let cp = cps[--pos];
		let br = node.branches.find(x => x.set.has(cp));
		if (!br) break;
		node = br.node;
		if (node.save) { // remember
			saved = cp;
		} else if (node.check) { // check exclusion
			if (cp === saved) break;
		}
		stack.push(cp);
		if (node.fe0f) {
			stack.push(FE0F);
			if (pos > 0 && cps[pos - 1] == FE0F) pos--; // consume optional FE0F
		}
		if (node.valid) { // this is a valid emoji (so far)
			emoji = conform_emoji_copy(stack, node);
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	if (!emoji) {
		let cp = cps[cps.length-1];
		if (EMOJI_SOLO.has(cp)) {
			if (eaten) eaten.push(cp);
			emoji = [cp];
			cps.pop();
		}
	}
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = cps.slice(); // copy stack
	if (node.valid == 2) copy.splice(1, 1); // delete FE0F at position 1 (see: make.js)
	return copy;
}

// return all supported emoji (not sorted)
function ens_emoji() {
	let ret = [...EMOJI_SOLO].map(x => [x]);
	build(EMOJI_ROOT, []);
	return ret;
	function build(node, cps, saved) {
		if (node.save) { // remember
			saved = cps[cps.length-1];
		} else if (node.check) { // check exclusion
			if (saved === cps[cps.length-1]) return;
		}
		if (node.fe0f) cps.push(FE0F);
		if (node.valid) ret.push(conform_emoji_copy(cps, node));
		for (let br of node.branches) {
			for (let cp of br.set) {
				build(br.node, [...cps, cp], saved);
			}
		}
	}
}

// ************************************************************
// tokenizer 

const TY_VALID = 'valid';
const TY_MAPPED = 'mapped';
const TY_IGNORED = 'ignored';
const TY_DISALLOWED = 'disallowed';
const TY_EMOJI = 'emoji';
const TY_ISOLATED = 'isolated';
const TY_NFC = 'nfc';
const TY_STOP = 'stop';

function ens_tokenize(name) {
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({type: TY_EMOJI, emoji, input: eaten.slice(), cps: filter_fe0f(emoji)});
		} else {
			let cp = input.pop();
			if (cp === STOP) {
				tokens.push({type: TY_STOP});
			} else if (VALID.has(cp)) {
				if (ISOLATED.has(cp)) {
					tokens.push({type: TY_ISOLATED, cp});
				} else {
					tokens.push({type: TY_VALID, cps: [cp]});
				}
			} else if (IGNORED.has(cp)) {
				tokens.push({type: TY_IGNORED, cp});
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					tokens.push({type: TY_MAPPED, cp, cps: cps.slice()});
				} else {
					tokens.push({type: TY_DISALLOWED, cp});
				}
			}
		}
	}
	for (let i = 0, start = -1; i < tokens.length; i++) {
		let token = tokens[i];
		if (is_valid_or_mapped(token.type)) {
			if (requires_check(token.cps)) { // normalization might be needed
				let end = i + 1;
				for (let pos = end; pos < tokens.length; pos++) { // find adjacent text
					let {type, cps} = tokens[pos];
					if (is_valid_or_mapped(type)) {
						if (!requires_check(cps)) break;
						end = pos + 1;
					} else if (type !== TY_IGNORED) { // || type !== TY_DISALLOWED) { 
						break;
					}
				}
				if (start < 0) start = i;
				let slice = tokens.slice(start, end);
				let cps0 = slice.flatMap(x => is_valid_or_mapped(x.type) ? x.cps : []); // strip junk tokens
				let cps = nfc(cps0); // this does extra work for nf-native but oh well
				//if (cps0.length === cps.length && cps0.every((cp, i) => cp === cps[i])) { 
				if (str_from_cps(cps0) === str_from_cps(cps)) {
					i = end - 1; // skip to end of slice
				} else { // bundle into an nfc token
					tokens.splice(start, end - start, {type: TY_NFC, input: cps0, cps, tokens: collapse_valid_tokens(slice)});
					i = start;
				}
				start = -1; // reset
			} else {
				start = i; // remember last
			}
		} else if (token.type === TY_EMOJI) {
			start = -1; // reset
		}
	}
	return collapse_valid_tokens(tokens);
}

function is_valid_or_mapped(type) {
	return type === TY_VALID || type === TY_MAPPED;
}

function requires_check(cps) {
	return cps.some(cp => NFC_CHECK.has(cp));
}

function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type === TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type === TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_normalize_post_check, ens_tokenize, nfc, nfd };
