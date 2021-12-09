// https://github.com/unicode-rs/unicode-normalization/blob/master/src/normalize.rs
// https://www.unicode.org/versions/Unicode14.0.0/ch03.pdf

import {cp, readFileSync} from 'fs';
import {Decoder} from './decoder.js';
function compressed() {
	//return readFileSync(new URL('tables-json/compressed.bin', import.meta.url).pathname);
	return readFileSync(new URL('tables-json/huffman.bin', import.meta.url).pathname);
}
//~IGNORE

// compressed lookup tables
let r = new Decoder(compressed());
const COMBINING_MARKS = r.read_member_table();
const IGNORED = r.read_member_table();
const DISALLOWED = r.read_member_table();
const JOIN_T = r.read_member_table();
const JOIN_LD = r.read_member_table();
const JOIN_RD = r.read_member_table();
//const VIRAMA = r.read_member_table();
const COMBINING_RANK = r.read_member_tables(1 + r.read());
const VIRAMA = COMBINING_RANK[r.read()];
const ZWNJ_EMOJI = r.read_emoji();
const MAPPED = r.read_mapped_table();
const DECOMP = r.read_mapped_table();


function lookup_member(table, cp) {
	for (let [x, n] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (d < n) return true;
	}
	return false;
}
function lookup_mapped(table, cp) {
	for (let [x, y, n, dx, dy] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (n > 0) {
			if (d < n && d % dx == 0) {
				let r = d / dx;
				return y.map(x => x + r * dy);
			} 
		} else if (d == 0) {
			return y;
		}
	}
}
// ************************************************************
// normalization forms

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

function get_combining_rank(cp) {
	return 1 + COMBINING_RANK.findIndex(table => lookup_member(table, cp));
}

export function nfd(cps) {
	let ret = [];
	let stack = [];
	cps.forEach(cp => decompose(cp, next));
	function pop() {
		ret.push(...stack.sort((a, b) => a[0] - b[0]).map(x => x[1]));
		stack.length = 0;
	}
	function next(cp) {
		let rank = get_combining_rank(cp);
		if (rank == 0) {
			pop();
			ret.push(cp);
		} else {
			stack.push([rank, cp]);
		}
	}
	pop();
	return ret;
}

