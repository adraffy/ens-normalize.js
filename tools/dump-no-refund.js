import {readFileSync, writeFileSync} from 'node:fs';
import {read_labels} from '../validate/data.js';
import {ens_normalize, ens_tokenize} from '../src/lib.js';
import eth_ens_namehash from '../test/eth-ens-namehash@2.0.15.min.js';

// see: https://github.com/adraffy/ens-normalize.js/blob/main/derive/rules/emoji.js#L116
let non_rgi = [];
function escape_cp(cp) {
	return `\\u{${cp.toString(16)}}`;
}
// single regionals
for (let cp = 0x1F1E6; cp <= 0x1F1FF; cp++) non_rgi.push(escape_cp(cp));
// solo skin colors
for (let cp = 0x1F3FB; cp <= 0x1F3FF; cp++) non_rgi.push(escape_cp(cp));
// zwj sequences
for (let emoji of [
	// windows: https://blog.emojipedia.org/ninja-cat-the-windows-only-emoji/
	'🐱‍🐉','🐱‍💻','🐱‍🚀','🐱‍👤','🐱‍🏍','🐱‍👓',
	// man wrestler
	'🤼🏻‍♂','🤼🏼‍♂','🤼🏽‍♂','🤼🏾‍♂','🤼🏿‍♂', 
	// woman wrestler
	'🤼🏻‍♀','🤼🏼‍♀','🤼🏽‍♀','🤼🏾‍♀','🤼🏿‍♀', 
]) non_rgi.push(`${[...emoji].map(x => escape_cp(x.codePointAt(0))).join('')}\uFE0F?`);
const non_rgi_regex = new RegExp(`(${non_rgi.join('|')})`, 'ug');
console.log(non_rgi_regex);

/*
/(\u{1f1e6}|\u{1f1e7}|\u{1f1e8}|\u{1f1e9}|\u{1f1ea}|\u{1f1eb}|\u{1f1ec}|\u{1f1ed}|\u{1f1ee}|\u{1f1ef}|\u{1f1f0}|\u{1f1f1}|\u{1f1f2}|\u{1f1f3}|\u{1f1f4}|\u{1f1f5}|\u{1f1f6}|\u{1f1f7}|\u{1f1f8}|\u{1f1f9}|\u{1f1fa}|\u{1f1fb}|\u{1f1fc}|\u{1f1fd}|\u{1f1fe}|\u{1f1ff}|\u{1f3fb}|\u{1f3fc}|\u{1f3fd}|\u{1f3fe}|\u{1f3ff}|\u{1f431}\u{200d}\u{1f409}️?|\u{1f431}\u{200d}\u{1f4bb}️?|\u{1f431}\u{200d}\u{1f680}️?|\u{1f431}\u{200d}\u{1f464}️?|\u{1f431}\u{200d}\u{1f3cd}️?|\u{1f431}\u{200d}\u{1f453}️?|\u{1f93c}\u{1f3fb}\u{200d}\u{2642}️?|\u{1f93c}\u{1f3fc}\u{200d}\u{2642}️?|\u{1f93c}\u{1f3fd}\u{200d}\u{2642}️?|\u{1f93c}\u{1f3fe}\u{200d}\u{2642}️?|\u{1f93c}\u{1f3ff}\u{200d}\u{2642}️?|\u{1f93c}\u{1f3fb}\u{200d}\u{2640}️?|\u{1f93c}\u{1f3fc}\u{200d}\u{2640}️?|\u{1f93c}\u{1f3fd}\u{200d}\u{2640}️?|\u{1f93c}\u{1f3fe}\u{200d}\u{2640}️?|\u{1f93c}\u{1f3ff}\u{200d}\u{2640}️?)/gu
*/

// remove real emoji and non-rgi emoji with FE0F allowance
// keep everything else
function filter_emoji(s) {
	return String.fromCodePoint(...ens_tokenize(s.replace(non_rgi_regex, '')).flatMap(token => {
		switch (token.type) { 
			case 'emoji': return []; // ignore
			case 'nfc': return token.input; // pre-nfc
			case 'mapped':
			case 'valid': return token.cps;
			default: return token.cp;
		}
	}));
}

function is_invis_spoof(s) {
	return /(\uFE0F|\uFE0E|\u200C|\u200D)/u.test(filter_emoji(s));
}

let found = 0;
let spoof_invis = [];

let labels = read_labels();
//let labels = JSON.parse(readFileSync(new URL('../../ens-registered/20230322.json', import.meta.url))).map(v => v[0]);
//let labels = readFileSync(new URL('./refund_names.csv', import.meta.url), {encoding: 'utf8'});
//labels = labels.split('\n');

for (let label of labels) {
	if ([...label].length < 3) continue; // too short
	try {
		if (label !== eth_ens_namehash.normalize(label)) continue; // not norm0
	} catch (err) {
		continue; // failed norm0
	}
	let norm;
	try {
		norm = ens_normalize(label);
		if (norm === label) continue; // same
	} catch (err) {
	}
	found++;
	if (is_invis_spoof(label)) {
		spoof_invis.push(label);
	}
}
console.log({
	count: labels.length,
	found,
	invis: spoof_invis.length,
});
writeFileSync(new URL('./no-refund.json', import.meta.url), JSON.stringify({
	count: labels.length,
	found,
	spoof_invis
}, null, '\t'));

// double-check matoken
let matoken = 0;
for (let label of readFileSync(new URL('./refund_names.csv', import.meta.url), {encoding: 'utf8'}).split('\n')) {
	try {
		ens_normalize(label);		
		continue;
	} catch (err) {	
	}
	if (is_invis_spoof(label)) {
		matoken++;
	}
}
console.log({matoken});