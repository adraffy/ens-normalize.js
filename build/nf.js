import {decode_payload, read_member_set, read_mapped_table, lookup_mapped} from './decoder.js';
import PAYLOAD from './output/nf.js';

let r = decode_payload(PAYLOAD);
const COMBINING_RANK = Array(1 + r()).fill().map(() => read_member_set(r));
const DECOMP = read_mapped_table(r);
const COMP_EXCLUSIONS = read_member_set(r);

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
				if (COMP_EXCLUSIONS.has(combined)) break;
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
		let rank = 1 + COMBINING_RANK.findIndex(table => table.has(cp));
		if (rank == 0) {
			drain();
			callback(rank, cp);
		} else {
			stack.push([rank, cp]);
		}
	}
}

export function nfd(cps) {
	let ret = [];
	decomposer(cps, (_, cp) => ret.push(cp));
	return ret;
}

export function nfc(cps) {
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