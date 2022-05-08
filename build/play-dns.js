import {inspect} from 'util';
import {explode_cp} from './utils.js';
import {ens_normalize} from './lib-normalize-release.js';
import {dns_from_normalized_ens} from './lib-dns.js';
import {puny_decode} from './puny.js';

console.log(String.fromCodePoint(...puny_decode(explode_cp('zca'))));

console.log(dns_from_normalized_ens(ens_normalize('Raffy.eth')));

console.log(dns_from_normalized_ens(ens_normalize('💩.eth')));

console.log(dns_from_normalized_ens('-test'));