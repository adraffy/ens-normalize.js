//import {ens_normalize} from '../index.js';
import {ens_normalize} from '../build/ens-normalize.js';
import {mkdirSync, writeFileSync, readFileSync} from 'fs';
import {join} from 'path';
import {escape_unicode} from '../build/utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let output_dir = join(base_dir, 'output');
let tests = JSON.parse(readFileSync(join(base_dir, '../build/unicode-json/IdnaTestV2.json')));

mkdirSync(output_dir, {recursive: true});

let sections = [];
for (let [name, cases] of Object.entries(tests)) {
	let html = `<a name="${name}"><h2>${name} (${cases.length})</h2></a>
	<table><thead><tr>
	<th>#</th><th width="32%">Input</th><th width="32%">Expected</th><th width="32%">Normalized</th>
	</tr></thead><tbody>`;
	let tally = {};
	for (let i = 0; i < cases.length; i++) {
		let test_case = cases[i];
		let [input, output, errors] = test_case;
		errors = new Set(errors);
		errors.delete('X4_2');
		errors = [...errors];
		if (!output) output = input;
		let norm, norm_err;
		try {
			norm = ens_normalize(input);
		} catch (err) {
			norm_err = err.message;
		}
		let type;
		if (errors.length > 0) {
			if (norm_err) {
				type = 'same-error';
			} else {
				type = 'allow-error';
			}
		} else {
			if (norm_err) {
				type = 'reject-valid';
			} else if (norm !== output) {
				type = 'diff-norm';
			} else {
				type = 'same-norm';
			}
		}
		tally[type] = (tally[type] ?? 0) + 1;
		let row = `<tr class="${type}"><td class="index">${i+1}</td><td class="input name">${escape_unicode(input)}</td>`;
		if (errors.length > 0) {
			row += `<td class="error">${errors.join(', ')}</td>`;
		} else {
			row += `<td class="name">${escape_unicode(output)}</td>`;
		}
		if (type === 'same') {
			row += `<td class="eq">Same</td>`;
		} else if (norm_err) {
			row += `<td class="error">${norm_err}</td>`;
		} else {
			row += `<td class="name">${escape_unicode(norm)}</td>`;
		}
		row += `</tr>`;		
		html += row;
		test_case.type = type;
		test_case.result = norm_err ?? norm;
	}
	html += `</tbody></table>`;
	sections.push({name, html, tally});
}

let html = `<!doctype html><html><head><meta charset="utf-8"><title>IdnaTestV2</title><style>
table { border-collapse: collapse; width: 100%; max-width: 100%; }
th { text-align: left; }
td { border: 1px solid #ccc; line-break: anywhere; }
.same-norm { background: #cfc; }
.same-error { background: #cff; }
.diff-norm { background: #f96; }
.allow-error { background: #fcc; }
.reject-valid { background: #f66; }
.index { text-align: center; font-weight: bold; }
.eq { color: #aaa; }
#overall td, #overall th { text-align: right; }
#overall tbody tr:nth-child(odd) { background: #eee; }
</style></head><body><h1>IdnaTestV2</h1>`;

let cols = ['same-norm', 'same-error', 'allow-error', 'reject-valid', 'diff-norm'];
html += [
	`<table id="overall"><thead><tr>`,
	`<th>Test</th>`,
	`<th>#</th>`,
	`<th>same</th>`,
	...cols.map(x => `<th>${x}</th>`),
	`</tr></thead><tbody>`
].join('');
for (let {name, tally} of sections) {
	let total = Object.values(tally).reduce((a, x) => a + x, 0);
	let same = (tally['same-norm'] ?? 0) + (tally['same-error'] ?? 0);
	html += [
		'<tr>',
		`<td><a href="#${name}">${name}</a></td>`,
		`<td>${total}</td>`,
		`<td>${(100 * same / total).toFixed(1)}%</td>`,
		...cols.map(x => `<td>${tally[x] ?? 0}</td>`),
		'</tr>'
	].join('');
}
html += `</tbody></table>`;
html += sections.map(x => x.html).join('\n');
html += `</body></html>`

writeFileSync(join(output_dir, 'idna.html'), html);
writeFileSync(join(output_dir, 'idna.json'), JSON.stringify(tests));