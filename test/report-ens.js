import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {escape_unicode, escape_name_for_html, parse_cp} from '../build/utils.js';
import LABELS from './registered-labels.js';

// adraffy
import {ens_normalize} from '../index.js';
// ens
import lib from 'eth-ens-namehash';

let output_dir = new URL('./output/', import.meta.url).pathname;
mkdirSync(output_dir, {recursive: true});

async function explode(s) {
	//return {label: s, points: [...s].map(x => x.codePointAt(0)).join(' '), owner: await get_owner(`${s}.eth`)};
	return {label: s, points: [...s].map(x => x.codePointAt(0)).join(' ')};
}

let buckets = {};
for (let label of LABELS) {
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

	console.log(`${type}[${bucket.length}] = ${escape_unicode(label)}`);
}
buckets = Object.entries(buckets);

const title = `eth-ens-namehash (ens) vs adraffy`;

let html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
table { border-collapse: collapse; width: 100%; }
td { border: 1px solid #ccc; line-break: anywhere; width: 25% }
tbody tr:nth-child(odd) { background: #eee; }
#ens-error td:nth-child(3), #adraffy-error td:nth-child(4) { background: #fdd; }
#overall td, #overall th { text-align: right; }
</style></head><body><h1>${title}</h1>`;

html += `<table id="overall"><thead><tr><th>Type</th><th>#</th><th>%</th></tr></thead><tbody>`
for (let [type, bucket] of buckets) {
	html += `<tr><td><a href="#${type}">${type}</a></td><td>${bucket.length}</td><td>${(100 * bucket.length / LABELS.length).toFixed(3)}%</td></tr>`;
}
html += '</tbody></table>';

function ens_error(s) {
	let match = s.match(/Illegal char (.*)/);
	if (match) return `Illegal char: "${escape_name_for_html(match[1])}"`;
	return s;
}

function adraffy_error(s) {
	return s.replaceAll(/{([0-9A-F]+)}/g, (_, x) => escape_name_for_html(String.fromCodePoint(parse_cp(x))));
}

function escape_unicode_for_html(s) {
	return escape_name_for_html(escape_unicode(s));
}

for (let [type, bucket] of buckets) {
	let temp = `<a name="${type}"><h2>${type} (${bucket.length})</h2></a><table id="${type}"><thead><tr>
	<th colspan="2">Unicode</th><th>ens</th><th>adraffy</th>
	</tr></thead><tbody>`;
	let ens_fmtr = escape_unicode_for_html;
	let adraffy_fmtr = escape_unicode_for_html;
	switch (type) {
		case 'ens-error': 
			ens_fmtr = ens_error;
			break;
		case 'adraffy-error':
			adraffy_fmtr = adraffy_error;
			break;
		case 'both-error':
			adraffy_fmtr = adraffy_error;
			ens_fmtr = ens_error;
			break;
	}
	temp += bucket.map(({label, ens, adraffy}) => `<tr><td>${escape_name_for_html(label)}</td><td>${escape_unicode_for_html(label)}</td><td>${ens_fmtr(ens)}</td><td>${adraffy_fmtr(adraffy)}</td></tr>`).join('');
	temp += '</tbody></table>';
	html += temp;
}
html += `</body></html>`;

writeFileSync(join(output_dir, 'ens3.html'), html);
//writeFileSync(join(output_dir, 'ens.json'), JSON.stringify(buckets));