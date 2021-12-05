import {ens_normalize} from '../index.js';
import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {escape_unicode} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');

mkdirSync(output_dir, {recursive: true});

let labels = readFileSync(join(base_dir, 'data/eth-labels-20211127-134810-rx6ulbdm52rz.csv'), {encoding: 'utf8'}).split('\n');

let errors = [];
let diffs = [];
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

const title = 'Registered';

let html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
table { border-collapse: collapse; width: 100%; }
td { border: 1px solid #ccc; line-break: anywhere; }
td.rep { font-weight: bold; }
th { width: 33%; }
tbody tr:nth-child(odd) { background: #eee; }
</style></head><body><h1>${title}</h1>`;

html += `<h2>Different (${diffs.length} of ${labels.length})</h2>`;
if (diffs.length > 0) {
	html += `<table><thead><tr><th>Unicode</th><th>Label</th><th>adraffy</th></tr></thead><tbody>`;
	for (let {label, norm} of diffs) {
		html += `<tr><td class="rep">${html_escape(label)}</td><td class="name">${escape_unicode(label)}</td><td class="name">${escape_unicode(norm)}</td></tr>`;
	}
	html += '</tbody></table>';
}
html += `<h2>Error (${errors.length} of ${labels.length})</h2>`;
if (errors.length > 0) {
	html += `<table><thead><tr><tr><th>Unicode</th><th>Label</th><th>Error</th></tr></thead><tbody>`;
	for (let {label, error} of errors) {
		html += `<tr><td class="rep">${html_escape(label)}</td><td class="name">${escape_unicode(label)}</td><td class="error">${error}</td></tr>`;
	}
	html += '</tbody></table>';
}
html += `</body></html>`

writeFileSync(join(output_dir, 'registered.html'), html);
writeFileSync(join(output_dir, 'registered.json'), JSON.stringify({diffs, errors}));

function html_escape(s) {
	return s.replace( /[^0-9a-z ]/iug, x => `&#${x.codePointAt(0)}`);
}