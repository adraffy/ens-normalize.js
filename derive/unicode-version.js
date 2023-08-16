import {UnicodeSpec, UnicodePrinter} from './unicode-logic.js';
import {ens_idna_rules} from './idna.js';
import {create_nf} from './nf.js';

export const UNICODE = new UnicodeSpec(
	new URL('./data/15.1.0/', import.meta.url), 
	new URL('./data/CLDR-43/', import.meta.url));

export const NF = create_nf(UNICODE);

export const IDNA = ens_idna_rules(UNICODE);

export const PRINTER = new UnicodePrinter(UNICODE);
