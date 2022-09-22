import {UnicodeSpec} from './unicode-logic.js';
import {create_nf} from './nf.js';

export const SPEC = new UnicodeSpec(new URL('./data/15.0.0/', import.meta.url));

export const NF = create_nf(SPEC);
if (NF.run_tests().length) throw new Error('nf implementation wrong');
NF.run_random_tests();

export const IDNA = SPEC.idna_rules({
	version: 2003, // https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
	use_STD3: true, 
	valid_deviations: true // because 200C and 200D were allowed
});

