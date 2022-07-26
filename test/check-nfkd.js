import REGISTERED from './data/eth-labels.js';
import {generate_cps, read_idna_rules} from '../build/unicode-logic.js';
import {explode_cp, hex_cp, split_between} from '../build/utils.js';
import {nfd} from '../build/nf.js';
import {inspect} from 'util';


let {valid, mapped, ignored} = read_idna_rules({version: 2003, valid_deviations: true});

/*

// https://www.unicode.org/L2/L2008/08417-tr46.html#Construction

ignored
U+00AD ( ) SOFT HYPHEN
U+034F ( ) COMBINING GRAPHEME JOINER
U+200B ( ) ZERO WIDTH SPACE
U+2060 ( ) WORD JOINER
Variation Selectors: FE00 to FE0F, E0100 to E01EF	
U+FEFF ( ) ZERO WIDTH NO-BREAK SPACE 
U+1BCA0	SHORTHAND FORMAT LETTER OVERLAP
U+1BCA1	SHORTHAND FORMAT CONTINUING OVERLAP
U+1BCA2	SHORTHAND FORMAT DOWN STEP
U+1BCA3	SHORTHAND FORMAT UP STEP

disallowed
U+1806 ( ᠆ ) MONGOLIAN TODO SOFT HYPHEN

mapped
U+2F868 ( ? ) CJK COMPATIBILITY IDEOGRAPH-2F868 => U+2136A ( ? ) CJK UNIFIED IDEOGRAPH-2136A
U+2F874 ( ? ) CJK COMPATIBILITY IDEOGRAPH-2F874 => U+5F33 ( ? ) CJK UNIFIED IDEOGRAPH-5F33
U+2F91F ( ? ) CJK COMPATIBILITY IDEOGRAPH-2F91F => U+43AB ( ? ) CJK UNIFIED IDEOGRAPH-43AB
U+2F95F ( ? ) CJK COMPATIBILITY IDEOGRAPH-2F95F => U+7AAE ( ? ) CJK UNIFIED IDEOGRAPH-7AAE
U+2F9BF ( ? ) CJK COMPATIBILITY IDEOGRAPH-2F9BF => U+4D57 ( ? ) CJK UNIFIED IDEOGRAPH-4D57

*?

for (let cp of generate_cps()) {
	let cps = explode_cp(String.fromCodePoint(cp).normalize('NKFD'));


}
*/

//console.log(inspect([...ignored].map(hex_cp), {maxArrayLength: null}));

console.log(mapped.filter(v => v[0] === 0x2F868))