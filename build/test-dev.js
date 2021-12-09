import {ens_normalize} from './ens-normalize.js';

// this confirms that the library works without encoding/decoding
console.log(ens_normalize('Raffy.eth'));

console.log(ens_normalize('0' + String.fromCodePoint(0xE0) + '.' + String.fromCodePoint(0x5D0)));