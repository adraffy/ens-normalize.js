import {UnicodeSpec, UnicodePrinter} from './unicode-logic.js';
import {create_nf} from './nf.js';

export const UNICODE = new UnicodeSpec(
	new URL('./data/15.0.0/', import.meta.url), 
	new URL('./data/CLDR-42/', import.meta.url));

export const NF = create_nf(UNICODE);

export const IDNA = UNICODE.derive_idna_rules({
	// because 2008 makes emoji invalid
	// question: does anyone use 2008?
	version: 2003, 
	
	// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
	use_STD3: true, 
	
	// because 200C and 200D were allowed (deviations)
	// this is effectively "Nontransitional Processing" with a better name
	// https://unicode.org/reports/tr46/#Deviations
	// 20220123: this is also the WHATWG URL recommendation
	// https://url.spec.whatwg.org/#idna
	valid_deviations: true 
});

export const PRINTER = new UnicodePrinter(UNICODE);
