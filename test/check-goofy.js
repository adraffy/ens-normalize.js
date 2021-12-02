// scan list of non-ascii labels
// find errors and diffs

import {ens_normalize} from '../ens-normalize.js';
import {readFileSync, writeFileSync} from 'fs';

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

let errors = [];
let diffs = [];

let labels = readFileSync(local_file('goofy-labels.txt'), {encoding: 'utf8'}).split('\n');
for (let label of labels) {
	try {
		let norm = ens_normalize(label);
		if (norm != label) {
			diffs.push({label, norm});
		}
	} catch (err) {
		errors.push({label, error: err.message});
	}
}

/*
console.log({
	errors: errors.length,
	diffs: diffs.length
});

writeFileSync(local_file('output/goofy-errors.json'), JSON.stringify(errors));
writeFileSync(local_file('output/goofy-diffs.json'), JSON.stringify(diffs));
*/

function code_str(v) {
	return '<tt>' + (v.length == 0 ? '<i>empty</i>' : [...v].map(x => x.codePointAt(0).toString(16).padStart(2, '0')).join(' ')) + '</tt>';
}

function html_escape(s) {
	return s.replace( /[^0-9a-z ]/iug, x => `&#${x.codePointAt(0)}`);
}

let html = `<!doctype html><html><head><meta charset="utf-8"><style>
table { border-collapse: collapse; }
td { border: 1px solid #ccc; }
tbody tr:nth-child(4n+1), tbody tr:nth-child(4n+2) { background: #eee; }
.name { line-break: anywhere; }
</style></head><body>`;
html += `<h2>Different (${diffs.length} of ${labels.length})</h2>`;
if (diffs.length > 0) {
	html += `<table><thead><th>Name</th><th>Codepoints</th><tbody>`;
	for (let {label, norm} of diffs) {
		html += `<tr><td class="name">${html_escape(label)}</td><td>${code_str(label)}</td></tr>`;
		html += `<tr><td class="name">${html_escape(norm)}</td><td>${code_str(norm)}</td>`;
	}
	html += '</tbody></table>';
}
html += `<h2>Error (${errors.length} of ${labels.length})</h2>`;
if (errors.length > 0) {
	html += `<table><thead><th>Name</th><th>Codepoints</th><th>Error</th></thead><tbody>`;
	for (let {label, error} of errors) {
		html += `<tr><td class="name">${html_escape(label)}</td><td>${code_str(label)}</td><td>${error}</td></td>`;
	}
	html += '</tbody></table>';
}
html += `</body></html>`

writeFileSync(local_file('output/goofy.html'), html);