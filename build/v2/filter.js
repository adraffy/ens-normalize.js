import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {read_parsed} from '../nodejs-utils.js';
import {parse_cp_range} from '../utils.js';

const base_dir = new URL('.', import.meta.url).pathname;
const Names = Object.entries(read_parsed('Names')).map(([k, v]) => [parseInt(k, 16), v]);
const {Common, Latin, Greek, Cyrillic} = read_parsed('Scripts');

let filtered = new Set([Common, Latin, Greek, Cyrillic].flat().flatMap(parse_cp_range));

import EMOJI_SET from './emoji-post-idna.js';
for (let cp of EMOJI_SET) {
	filtered.delete(cp);
}

writeFileSync('./dump.js', [
	'export default [',
	,
	']'
].join('\n'));

/*

function make_filtered(set, src_file, dst_file) {
	let lines = [];
	for (let line of readFileSync(src_file, {encoding: 'utf-8'}).split('\n')) {
		line = line.trim();
		if (!line) continue;
		let cp = parseInt(line.slice(0, line.indexOf(',')), 16);
		if (!set.has(cp)) continue;
		lines.push(line);
	}
	writeFileSync(dst_file, lines.join('\n'));
	return dst_file;
}

let file0 = join(base_dir, '../unicode-raw/UnicodeData.txt');
let file1 = join(base_dir, 'UnicodeData-Filtered.txt');
let file2 = join(base_dir, 'UnicodeData-Filtered2.txt');

make_filtered(filtered, file0, file1);



for (let cp of JSON.parse(readFileSync(join(base_dir, 'letters.json')))) {
	filtered.delete(cp);
}
make_filtered(filtered, file1, file2);
*/

/*



writeFileSync(join(base_dir, 'UnicodeData-Filtered2.txt'), lines.filter(line => {
	let name = line.split(';')[1];
	if (/\b[A-Z]\b/.test(name)) {
		return true;
	}
}).join('\n'));



writeFileSync(join(base_dir, 'UnicodeData-.txt'), lines.filter(line => {
	let name = line.split(';')[1];
	if (/\b[A-Z]\b/.test(name)) {
		return true;
	}
}).join('\n'));

writeFileSync(join(base_dir, 'UnicodeData-NotLetters.txt'), lines.filter(line => {
	let name = line.split(';')[1];
	if (!/\b[A-Z]\b/.test(name)) {
		return true;
	}
}).join('\n'));

writeFileSync(join(base_dir, 'UnicodeData-Numbers.txt'), lines.filter(line => line.includes('DIGIT') || line.includes('NUMBER')).join('\n'));

writeFileSync(join(base_dir, 'UnicodeData-Control.txt'), lines.filter(line => line.includes('<control>')).join('\n'));

*/