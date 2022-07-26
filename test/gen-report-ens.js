import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {escape_unicode, escape_name_for_html, parse_cp, quote_cp, html_escape_cp} from '../build/utils.js';
import REGISTERED from './data/eth-labels.js';


//import lib from 'eth-ens-namehash';
import lib from '@ensdomains/eth-ens-namehash';
const namehash = lib.normalize.bind(lib);
function ens_error(s) {
	let match = s.match(/Illegal char (.*)/);
	if (match) return `Illegal char: "${escape_name_for_html(match[1])}"`;
	return s;
}

function adraffy_error(s) {
	return s.replaceAll(/{([0-9A-F]+)}/g, (_, x) => escape_name_for_html(String.fromCodePoint(parse_cp(x))));
}

let base_dir = new URL('./', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');
mkdirSync(output_dir, {recursive: true});

const ENS_VERSION = JSON.parse(readFileSync(join(base_dir, 'node_modules/@ensdomains/eth-ens-namehash/package.json'))).version;

//generate_report(output_dir, await import('../dist/ens-normalize-debug.js'));
//generate_report(output_dir, await import('../dist/ens-normalize-v2-debug.js'));
generate_report(output_dir, await import('../dist/ens-normalize-v3-debug.js'));
//generate_report(output_dir, await import('../dist/ens-normalize-compat.js'));

function generate_report(dir, module) {
	const {ens_normalize, NAME, BUILT, VERSION} = module;

	let buckets = {};
	for (let label of REGISTERED) {
		let ens, ens_err;
		try {
			ens = namehash(label);
		} catch (err) {
			ens_err = err.message;
		}
		let adraffy, adraffy_err;
		try {
			adraffy = ens_normalize(label);
		} catch (err) {
			adraffy_err = err.message;
			if (adraffy_err.startsWith('Disallowed label')) {
				adraffy_err = adraffy_err.slice(adraffy_err.lastIndexOf(': ') + 2);
			}
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

	let title = `eth-ens-namehash (${ENS_VERSION}) vs ${NAME} (${VERSION}) [${REGISTERED.size}]`;

	let html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
	body { margin: 1rem; }
	table { border-collapse: collapse; width: 100%; }
	td { border: 1px solid #ccc; line-break: anywhere; width: 25%;  }
	td div { max-height: 10rem; overflow: auto; max-width: 25vw; }
	tbody tr:nth-child(odd) { background: #eee; }
	#ens-error td:nth-child(3), #adraffy-error td:nth-child(4) { background: #fdd; }
	#overall td, #overall th { text-align: right; }
	#version { position: absolute; right: 1rem; top: 1rem; text-align: right; }
	</style></head><body><h1>${title}</h1><div id="version">
	<a href="https://github.com/adraffy/ens-normalize.js">@adraffy/ens-normalize</a><br><code>${BUILT}</code></div>`;

	html += `<table id="overall"><thead><tr><th>Type</th><th>#</th><th>%</th></tr></thead><tbody>`;
	function format_total(name, n) {
		return `<tr><td>${name}</td><td>${n}</td><td>${(100 * n / REGISTERED.size).toFixed(3)}%</td></tr>`;
	}
	html += format_total('same-norm', REGISTERED.size - Object.values(buckets).reduce((a, v) => a + v.length, 0));
	for (let [type, bucket] of Object.entries(buckets)) {
		html += format_total(`<a href="#${type}">${type}</a>`, bucket.length);
	}
	html += '</tbody></table>';


	for (let [type, bucket] of Object.entries(buckets)) {
		let temp = `<a name="${type}"><h2>${type} (${bucket.length})</h2></a><table id="${type}"><thead><tr>
		<th colspan="2">Unicode</th><th>ens</th><th>adraffy</th>
		</tr></thead><tbody>`;
		let ens_fmtr = escape_unicode_for_html;
		let adraffy_fmtr = escape_unicode_for_html;	
		let sort_fn = (a, b) => a.adraffy.localeCompare(b.adraffy);
		switch (type) {
			case 'ens-error': {
				sort_fn = (a, b) => a.ens.localeCompare(b.ens);
				ens_fmtr = ens_error;
				break;
			}
			case 'adraffy-error': {
				adraffy_fmtr = adraffy_error;
				break;
			}
			case 'both-error': {
				adraffy_fmtr = adraffy_error;
				ens_fmtr = ens_error;
				break;
			}
		}
		temp += bucket.sort(sort_fn).map(({label, ens, adraffy}) => `<tr>
			<td><div>${escape_name_for_html(label)}</div></td>
			<td><div>${escape_unicode_for_html(label)}</div></td>
			<td><div>${ens_fmtr(ens)}</div></td>
			<td>${adraffy_fmtr(adraffy)}</td>
		</tr>`).join('');
		temp += '</tbody></table>';
		html += temp;
	}
	html += `</body></html>`;
	
	writeFileSync(join(dir, `ens-${ENS_VERSION}-${NAME}-${VERSION}.html`), html);
	writeFileSync(join(dir, `ens-${ENS_VERSION}-${NAME}-${VERSION}.json`), JSON.stringify(buckets));
}

function escape_unicode_for_html(s) {
	return escape_name_for_html(escape_unicode(s));
}
