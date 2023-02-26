import {compare_arrays, explode_cp, permutations} from './utils.js';

// algorithmic hangul
// https://www.unicode.org/versions/Unicode10.0.0/ch03.pdf (page 149) 
// https://www.unicode.org/versions/Unicode15.0.0/ch03.pdf (page 144) <same>
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

function compose_pair(RECOMP, a, b) {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) { // LV
		let l_index = a - L0;
		let v_index = b - V0;
		let lv_index = l_index * N_COUNT + v_index * T_COUNT;
		return S0 + lv_index;
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

function unpack_cc(packed) {
	return (packed >> 24) & 0xFF;
}
function unpack_cp(packed) {
	return packed & 0xFFFFFF;
}

export function create_nf(unicode) {

	const SHIFTED_RANK = new Map(unicode.combining_ranks().flatMap((v, i) => v.map(cp => [cp, (i+1) << 24])));
	const COMP_EXCLUSIONS = new Set(unicode.read_composition_exclusions());
	const DECOMP = new Map();
	const RECOMP = new Map();

	for (let [cp, cps] of unicode.decompositions()) {
		DECOMP.set(cp, [...cps].reverse());
		if (!COMP_EXCLUSIONS.has(cp) && cps.length == 2) {
			let [a, b] = cps;
			let bucket = RECOMP.get(a);
			if (!bucket) {
				bucket = new Map();
				RECOMP.set(a, bucket);
			}
			bucket.set(b, cp);
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
		for (let cp0 of cps) {
			buf[0] = cp0;
			do {
				let cp = buf.pop();
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
			} while (buf.length);
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
				let composed = compose_pair(RECOMP, prev_cp, cp);
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

	return {
		nfd(cps) {
			return decomposed(cps).map(unpack_cp);
		},
		nfc(cps) {
			return composed_from_decomposed(decomposed(cps));
		},
		is_nfc(cp) {
			let cps = this.nfc([cp]);
			return cps.length === 1 && cps[0] === cp;
		},
		is_decomposed(cp) {
			let cps = this.nfd([cp]);
			return cps.length == 1 && cps[0] == cp; 
		},
		is_composite(cp) {
			return this.nfd([cp]).length > 1;
		},
		run_tests() {
			let errors = [];
			for (let [name, cases] of Object.entries(unicode.read_nf_tests())) {
				for (let strs of cases) {
					let [input, nfd0, nfc0] = strs.map(explode_cp);
					let nfd1 = this.nfd(input);
					if (compare_arrays(nfd0, nfd1)) {
						errors.push({name, input, nfd0, nfd1});
					}
					let nfc1 = this.nfc(input);
					if (compare_arrays(nfc0, nfc1)) {
						errors.push({name, input, nfc0, nfc1});
					}
				}
			}
			return errors;
		},
		run_random_tests(n = 10000, len = 256) {
			let v = [];
			for (; n > 0; n--) {
				for (let i = 0; i < len; i++) {
					v[i] = Math.random() * 0x110000|0;
				}
				if (compare_arrays(this.nfc(v), this.nfc(this.nfd(v)))) {
					throw new Error('random nfc');
				}
				if (compare_arrays(this.nfd(v), this.nfd(this.nfc(v)))) {
					throw new Error('random nfd');
				}
			}
		},
		// cp that are between NFC and NFD in composition graph
		// note: you can obviously compute this efficiently using
		// internal NF knowledge, however this avoids thinking
		inner_parts(cp0) {
			let cps0 = this.nfd([cp0]);
			let [base_cp, ...extra] = cps0;
			if (!extra.length) return [];
			let found = new Set();
			for (let perm of permutations(extra)) {
				for (let n = 1; n <= perm.length; n++) {
					let cps_part = this.nfc([base_cp, ...perm.slice(0, n)]);
					let cps_rest = this.nfc([...cps_part, ...perm.slice(n)]);
					if (cps_rest.length === 1 && cps_rest[0] === cp0) {
						for (let cp of cps_part) {
							if (cp !== cp0 && cp !== base_cp && !extra.includes(cp)) {
								found.add(cp);
							}
						}
					}
				}
			}
			return [...found];
		}
	};
};
