import {explode_cp, hex_cp} from '../utils.js';
import {UNICODE, SCRIPTS} from '../unicode-version.js';

let strings = [
    'Circle',
    'СігсӀе',
    'Сirсlе',
    'Circ1e',
    'C𝗂𝗋𝖼𝗅𝖾',
    '𝖢𝗂𝗋𝖼𝗅𝖾',
    '〆切',
    'ねガ'
];

const SEP = '/';

// https://www.unicode.org/reports/tr39/#Mixed_Script_Examples
for (let s of strings) {
    let cps = explode_cp(s);
    let resolved = [...SCRIPTS.get_resolved_script_set(cps)];
    console.log({
        format: s,
        hex: cps.map(hex_cp).join(' '),
        parts: cps.map(cp => UNICODE.format(cp)),
        extended: cps.map(cp => [...SCRIPTS.get_script_set(cp)].join(SEP)),
        augmented: cps.map(cp => [...SCRIPTS.get_augmented_script_set(cp)].join(SEP)),
        resolved,
        ss: resolved.length > 0
    });
}