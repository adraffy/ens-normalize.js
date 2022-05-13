import {inspect} from 'util';
import {ens_normalize, ens_tokenize} from './lib-normalize-v2.js';
import {escape_name_for_html, parse_cp_sequence} from './utils.js';


/*
const UNICODE = [];
for (let cp = 0; cp <= 0x10FFFF; cp++) {
	try {
		String.fromCodePoint(cp);
		UNICODE.push(cp);
	} catch (err) {	
	}
}
for (let cp of UNICODE) {
	try {
		ens_normalize(String.fromCodePoint(cp, 0x30FB));
	} catch (err) {
		if (err.message.includes('katakana')) {
			console.log(cp);
			throw 1;
		}
	}
}
*/

console.log(ens_normalize('うずまきナルト'));

/*
console.log(ens_normalize('نیم‌فاصله'));

console.log(inspect(ens_tokenize('🚴‍♂️.eth'), false, null, true));

console.log(ens_normalize('a.eth'));

// this confirms that the library works 
console.log(ens_normalize('Raffy.eth'));

console.log(inspect(ens_tokenize('R💩\uFE0Fa\xAD./'), false, null, true));

//let cps = cps_from_sequence('1F469 1F3FB 200D 2764 FE0F 200D 1F468 1F3FB');
//console.log(ens_normalize(String.fromCodePoint(...cps)));

//console.log(ens_normalize(escape_unicode('a' + String.fromCodePoint(0x200D) + 'b')));

//console.log(ens_normalize('\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}.eth'));

//console.log(ens_normalize('\u{1f3f3}\u{FE0F}\u{200d}\u{1f308}.eth'));


//console.log(ens_normalize('\u{0640}'));
//console.log(ens_normalize('xn--u-ccb'));

console.log(ens_normalize('xn--ls8h.eth'));

try {
	console.log(ens_normalize('bahrainمصر.eth'));
	throw new Error('no throw');
} catch (err) {
	console.error(err);
}

console.log(ens_tokenize(String.fromCodePoint(...parse_cp_sequence('1F3F4 E0067 E0062 E0065 E006E E0067 E007F'))));

console.log(ens_tokenize(String.fromCodePoint(...parse_cp_sequence('1F3F4 E0077 E007F'))));

console.log(ens_normalize(String.fromCodePoint(...parse_cp_sequence('1F468 200D 2764 FE0F 200D 1F468'))));
*/
