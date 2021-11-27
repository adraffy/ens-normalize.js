import {nameprep} from '@ethersproject/strings';
import {ens_normalize} from '../ens-normalize.js';
import KNOWN from './known.js';
import {writeFileSync} from 'fs';

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

function safe_adraffy(name) {
	try {
		return {norm: ens_normalize(name, true)};
	} catch (err) {
		return {error: err.message};
	}
}

function safe_ethers(name) {
	try {
		return {norm: nameprep(name)};
	} catch (err) {
		return {error: err.message};
	}
}

let results = [];

for (let {name} of KNOWN) {	
	let adraffy = safe_adraffy(name);
	let ethers = safe_ethers(name);
	let type;
	if (!adraffy.error != !ethers.error) {
		type = 'disagree';
	} else if (adraffy.error) {
		type = 'both-error';
	} else if (adraffy.norm != ethers.norm) {
		type = 'diff-norm';
	} else {
		type = 'same-norm';
	}
	results.push({type, name, adraffy, ethers});
}

function code_str(v) {
	return '<tt>' + [...v].map(x => x.codePointAt(0).toString(16).padStart(2, '0')).join(' ') + '</tt>';
}

function html_escape(s) {
	return s.replace( /[^0-9a-z ]/iug, x => `&#${x.codePointAt(0)}`);
}

let html = `<!doctype html><html><head><meta charset="utf-8"><style>
table { border-collapse: collapse; }
td { border: 1px solid #ccc; }
.same { background-color: #eee; }
.diff { background-color: #ffc; }
.fail { background-color: #fcc; }
</style></head><body>`;

function html_for_cell(name, info) {
	let {norm, error} = info;
	if (error) {
		return `<td class="fail" colspan="2">${error}</td>`;
	} else if (norm === name) {
		return `<td class="same" colspan="2">${html_escape(norm)}</td>`;
	} else {
		return `<td class="diff">${html_escape(norm)}</td><td class="diff">${code_str(norm)}</tt></td>`;
	}
}

for (let type of [...new Set(results.map(x => x.type))].sort((a, b) => a.localeCompare(b))) {
	let list = results.filter(x => x.type == type);
	html += `<h2>${type} (${list.length})</h2>`;
	html += `<table><thead><th colspan="2">Name</th><th colspan="2">adraffy</th><th colspan="2">ethers</th></thead><tbody>`;
	for (let {name, adraffy, ethers} of list) {
		html += `<tr><td>${html_escape(name)}</td><td>${code_str(name)}</td>`;
		html += html_for_cell(name, adraffy);
		html += html_for_cell(name, ethers);
		html += `</tr>`;
	}
	html += '</tbody></table>';	
}
html += `</body></html>`

writeFileSync(local_file('output/compare-ethers.html'), html);