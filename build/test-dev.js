import {ens_normalize} from './ens-normalize.js';
import {cps_from_sequence, escape_unicode} from './utils.js';

// this confirms that the library works 
console.log(ens_normalize('Raffy.eth'));

//let cps = cps_from_sequence('1F469 1F3FB 200D 2764 FE0F 200D 1F468 1F3FB');
//console.log(ens_normalize(String.fromCodePoint(...cps)));

//console.log(ens_normalize(escape_unicode('a' + String.fromCodePoint(0x200D) + 'b')));

console.log(ens_normalize('\u{1f3f3}\u{FE0F}\u{200d}\u{1f308}.eth'));