import {readFileSync} from 'fs';
import {join} from 'path';
import {recursive_encoder} from './utils.js';
import {encode2, encode3} from './encoder.js';

let base_dir = new URL('.', import.meta.url).pathname;
let tables_dir = join(base_dir, 'tables-json');

let {date, version, max_width, ...tables} = JSON.parse(readFileSync(join(tables_dir, `compressed.json`)));

for (let [k, v0] of Object.entries(tables)) {
	let {v: v2, n: n2} = recursive_encoder(encode2, v0);
	let {v: v3, n: n3} = recursive_encoder(encode3, v0);

	//console.log(v0);
	console.log([k, v0.length, v2.length - v3.length]);

}