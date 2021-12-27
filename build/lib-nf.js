import {explode_cp} from './utils.js';
import {nfc as nfc_adraffy, nfd as nfd_adraffy} from './nf';

// these use code-points
export {nfc_adraffy, nfd_adraffy};
export {nfc as nfc_default, nfd as nfd_default} from './nf0.js';

// these use strings
export function nfc(s) {
	return String.fromCodePoint(...nfc(explode_cp(s)));
}
export function nfd(s) {
	return String.fromCodePoint(...nfd(explode_cp(s)));
}