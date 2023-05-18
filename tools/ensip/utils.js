import {hex_cp} from '../../src/utils.js';
import {UNICODE} from '../../derive/unicode-version.js';

export {hex_cp};

export function tt(s) {
	return `\`${s}\``;
}

export function fmt_cp(cp) {
	return tt(`${hex_cp(cp)} (${String.fromCodePoint(cp)}) ${UNICODE.get_name(cp, true)}`);
}
