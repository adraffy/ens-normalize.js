import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {escape_unicode} from '../build/utils.js';

// adraffy
import {ens_normalize} from '../index.js';
// ens
import lib from 'eth-ens-namehash';

let base_dir = new URL('.', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');

mkdirSync(output_dir, {recursive: true});

let labels = readFileSync(join(base_dir, 'data/eth-labels-20211127-134810-rx6ulbdm52rz.csv'), {encoding: 'utf8'}).split('\n');

async function explode(s) {
	//return {label: s, points: [...s].map(x => x.codePointAt(0)).join(' '), owner: await get_owner(`${s}.eth`)};
	return {label: s, points: [...s].map(x => x.codePointAt(0)).join(' ')};
}


let buckets = {};
for (let label of labels) {
	let ens, ens_err;
	try {
		ens = lib.normalize(label);
	} catch (err) {
		ens_err = err.message;
	}
	let adraffy, adraffy_err;
	try {
		adraffy = ens_normalize(label);     
	} catch (err) {
		adraffy_err = err.message;
	}
	let type;
	let ret;
	if (ens_err) {
		if (adraffy_err) {
			type = 'both-error';
			ret = {ens: ens_err, adraffy: adraffy_err};
		} else {
			type = 'ens-error';
			ret = {ens: ens_err, adraffy};
		}
	} else if (adraffy_err) {
		type = 'adraffy-error';
		ret = {ens, adraffy: adraffy_err};
	} else if (ens !== adraffy) {
		type = 'diff-norm';
		ret = {ens, adraffy};
	} else {
		//type = 'same-norm';
		//ret = {ens, adraffy};
		continue;		
	}
	ret.label = label;

	let bucket = buckets[type];
	if (!bucket) buckets[type] = bucket = [];
	bucket.push(ret);
}
buckets = Object.entries(buckets);

const title = `eth-ens-namehash (ens) vs adraffy`;

let html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
table { border-collapse: collapse; width: 100%; }
td { border: 1px solid #ccc; line-break: anywhere; width: 25% }
tbody tr:nth-child(odd) { background: #eee; }
#ens-error td:nth-child(3), #adraffy-err td:nth-child(4) { background: #fcc; }
#overall td, #overall th { text-align: right; }
</style></head><body><h1>${title}</h1>`;

html += `<table id="overall"><thead><tr><th>Type</th><th>#</th><th>%</th></tr></thead><tbody>`
for (let [type, bucket] of buckets) {
	html += `<tr><td><a href="#${type}">${type}</a></td><td>${bucket.length}</td><td>${(100 * bucket.length / labels.length).toFixed(3)}%</td></tr>`;
}
html += '</tbody></table>';

function ens_error(s) {
	let match = s.match(/Illegal char (.*)/);
	if (match) return `Illegal char: ${escape_unicode(match[1])}`;
	return s;
}
for (let [type, bucket] of buckets) {
	let temp = `<a name="${type}"><h2>${type} (${bucket.length})</h2></a><table id="${type}"><thead><tr>
	<th colspan="2">Unicode</th><th>ens</th><th>adraffy</th>
	</tr></thead><tbody>`;
	let ens_fmtr = escape_unicode;
	let adraffy_fmtr = escape_unicode;
	switch (type) {
		case 'ens-error': 
			ens_fmtr = ens_error;
			break;
		case 'adraffy-error':
			adraffy_fmtr = x => x;
			break;
		case 'both-error':
			adraffy_fmtr = x => x;
			ens_fmtr = ens_error;
			break;
	}
	temp += bucket.map(({label, ens, adraffy}, i) => `<tr><td>${html_escape(label)}</td><td>${escape_unicode(label)}</td><td>${ens_fmtr(ens)}</td><td>${adraffy_fmtr(adraffy)}</td></tr>`).join('');
	temp += '</tbody></table>';
	html += temp;
}
html += `</body></html>`;

writeFileSync(join(output_dir, 'ens.html'), html);
writeFileSync(join(output_dir, 'ens.json'), JSON.stringify(buckets));

function html_escape(s) {
	return s.replace( /[^0-9a-z ]/iug, x => `&#${x.codePointAt(0)}`);
}
