import {readFileSync, writeFileSync} from 'fs';
import {base64_from_bytes} from './compress-utils.js';
import {encode2} from './coder-v2.js';

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

function recursive_encoder(fn, best, max = Infinity) {
	let n = 0;
	for (; n < max; n++) {
		let v = fn(best);
		if (v.length > best.length) break;
		best = v;
	}
	return {v: best, n}
}

// inject tables into template
let src = readFileSync(local_file('ens-normalize.src.js'), {encoding: 'utf8'});
for (let [k, v0] of Object.entries(JSON.parse(readFileSync(local_file('tables.json'))))) {
	let {v, n} = recursive_encoder(encode2, v0);
	let s = `bytes_from_base64('${base64_from_bytes(v)}')`;
	while (n-- > 0) s = `decode2(${s})`
	src = src.replace(`decompress('${k}')`, s);
}
writeFileSync(local_file('../ens-normalize.js'), src);