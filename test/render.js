import {readFileSync, writeFileSync} from 'fs';
import {base64_from_bytes} from './compress-utils.js';
import {encode2} from './coder-v2.js';

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

// inject tables into template
let src = readFileSync(local_file('ens-normalize.src.js'), {encoding: 'utf8'});
for (let [k, v] of Object.entries(JSON.parse(readFileSync(local_file('tables.json'))))) {
	let s;
	let vv = encode2(v);
	if (vv.length < v.length) {
		s = `decode2(bytes_from_base64('${base64_from_bytes(vv)}'))`;
	} else {
		s = `bytes_from_base64('${base64_from_bytes(v)}')`;
	}
	src = src.replace(`decompress('${k}')`, s);
}
writeFileSync(local_file('../ens-normalize.js'), src);