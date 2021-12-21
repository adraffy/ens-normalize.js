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
function decode_payload(s) {
	let values = decode_arithmetic(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
	let pos = 0;
	return () => values[pos++];
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

// returns [[x, n], ...] s.t. [x,3] == [x,x+1,x+2]
function read_member_table(next) {
	let v1 = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	return [
		...v1.map(x => [x, 1]),
		...vX.map((x, i) => [x, vN[i]])
	].sort((a, b) => a[0] - b[0]);
}

// returns array of 
// [x, ys] => single replacement rule
// [x, ys, n, dx, dx] => linear map
function read_mapped_table(next) {
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
	return ret.flat().sort((a, b) => a[0] - b[0]);
}

function read_ys_transposed(n, w, next) {
	let m = [read_deltas(n, next)];
	for (let j = 1; j < w; j++) {
		let v = Array(n);
		let prev = m[j - 1];
		for (let i = 0; i < n; i++) {
			v[i] = prev[i] + signed(next());
		}
		m.push(v);
	}
	return m;
}

function read_replacement_table(w, next) { 
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i])])
}

function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i]), vN[i], dx, dy]);
}

function lookup_member(table, cp) {
	for (let [x, n] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (d < n) return true;
	}
	return false;
}

function lookup_mapped(table, cp) {
	for (let [x, ys, n, dx, dy] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (n > 0) {
			if (d < dx * n && d % dx == 0) {
				let r = d / dx;
				return ys.map(y => y + r * dy);
			} 
		} else if (d == 0) {
			return ys;
		}
	}
}

var PAYLOAD = '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';

let r = decode_payload(PAYLOAD);
const COMBINING_RANK = Array(1 + r()).fill().map(() => read_member_table(r));
const DECOMP = read_mapped_table(r);
const COMP_EXCLUSIONS = read_member_table(r);

// algorithmic hangul
// https://www.unicode.org/versions/Unicode14.0.0/ch03.pdf
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
function decompose(cp, next) {
	if (cp < 0x80) {
		next(cp);
	} else if (is_hangul(cp)) {
		let s_index = cp - S0;
		let l_index = s_index / N_COUNT | 0;
		let v_index = (s_index % N_COUNT) / T_COUNT | 0;
		let t_index = s_index % T_COUNT;
		next(L0 + l_index);
		next(V0 + v_index);
		if (t_index > 0) next(T0 + t_index);
	} else {
		let mapped = lookup_mapped(DECOMP, cp);
		if (mapped) {
			for (let cp of mapped) {
				decompose(cp, next);
			}
		} else {
			next(cp);
		}
	}
}
function compose_pair(a, b) {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) { // LV
		let l_index = a - L0;
		let v_index = b - V0;
		let lv_index = l_index * N_COUNT + v_index * T_COUNT;
		return S0 + lv_index;
	} else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
		return a + (b - T0);
	} else {
		for (let [combined, v] of DECOMP) {		
			if (v.length == 2 && v[0] == a && v[1] == b) {
				if (lookup_member(COMP_EXCLUSIONS, combined)) break;
				return combined;
			}
		}
	}
	return -1;
}

function decomposer(cps, callback) {
	let stack = [];
	cps.forEach(cp => decompose(cp, next));
	drain();
	function drain() {
		stack.sort((a, b) => a[0] - b[0]).forEach(([rank, cp]) => callback(rank, cp));
		stack.length = 0;
	}
	function next(cp) {
		let rank = 1 + COMBINING_RANK.findIndex(table => lookup_member(table, cp));
		if (rank == 0) {
			drain();
			callback(rank, cp);
		} else {
			stack.push([rank, cp]);
		}
	}
}

function nfd$1(cps) {
	let ret = [];
	decomposer(cps, (_, cp) => ret.push(cp));
	return ret;
}

function nfc$1(cps) {
	let ret = [];
	let stack = [];
	let prev_cp = -1;
	let prev_rank = 0;
	decomposer(cps, next);
	if (prev_cp >= 0) ret.push(prev_cp);
	ret.push(...stack);	
	return ret;
	function next(rank, cp) {
		if (prev_cp === -1) {
			if (rank == 0) {
				prev_cp = cp;
			} else {
				ret.push(cp);
			}
		} else if (prev_rank > 0 && prev_rank >= rank) {
			if (rank == 0) {
				ret.push(prev_cp, ...stack);
				stack.length = 0;
				prev_cp = cp;
			} else {
				stack.push(cp);
			}
			prev_rank = rank;
		} else {
			let composed = compose_pair(prev_cp, cp);
			if (composed >= 0) {
				prev_cp = composed;
			} else if (prev_rank == 0 && rank == 0) {
				ret.push(prev_cp);
				prev_cp = cp;
			} else {
				stack.push(cp);
				prev_rank = rank;
			}
		}
	}
}

function norm(form, cps) {
	return [...String.fromCodePoint(...cps).normalize(form)].map(x => x.codePointAt(0));
}

// this is a polyfill for normalized forms
// which at the moment, this library costs 13KB
// however the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
function nfc(cps) { return norm('NFC', cps); }
function nfd(cps) { return norm('NFD', cps); }

export { nfc$1 as nfc_adraffy, nfc as nfc_default, nfd$1 as nfd_adraffy, nfd as nfd_default };
