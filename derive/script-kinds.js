export async function fetch_UAX31_script_kinds(version) {
	// unsure how to find the latest revision
	// download full spec to find revision number
	let html = await fetch_text(`https://www.unicode.org/versions/Unicode${version}/`);

	// find the latest revision number
	// https://www.unicode.org/reports/tr31/tr31-39.html
	let revision = 0;
	for (let match of html.matchAll(/\/tr31\/tr31-(\d+)\.html/gsu)) {
		revision = Math.max(revision, parseInt(match[1]));
	}
	if (!revision) throw new Error(`Unable to determine revision number`);

	// download the corresponding report
	html = await fetch_text(`https://www.unicode.org/reports/tr31/tr31-${revision}.html`);

	// parse the html tables as list of abbr
	// these tables dont seem to be available in any other unicode file
	let excluded = find_table(html, 'Table_Candidate_Characters_for_Exclusion_from_Identifiers');
	let recommended = find_table(html, 'Table_Recommended_Scripts');
	let limited_use = find_table(html, 'Table_Limited_Use_Scripts');

	// note: `Aspirational_Use_Scripts` removed in Unicode 10
	// As of Unicode 10.0, there is no longer a distinction between aspirational use and limited use scripts
	// as this has not proven to be productive for the derivation of identifier-related classes used in security profiles.
	// Thus the aspirational use scripts have been recategorized as limited use scripts.

	return {limited_use, excluded, recommended, revision};
}

async function fetch_text(url) {
	let res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
	return res.text();
}

function find_table(html, name) {	
	let pos = html.indexOf(`name="${name}"`);
	if (pos === -1) throw new Error(`Unable to find table "${name}"`);
	pos = html.indexOf('<table', pos);
	if (pos === -1) throw new Error(`Unable to find <table> ${name}"`);
	let end = html.indexOf('</table>', pos);
	if (end === -1) throw new Error(`Unable to find </table> ${name}`);
	html = html.slice(pos, end);
	let abbrs = [];
	for (let match of html.matchAll(/\{script=([a-z]+)\}/gsui)) {
		abbrs.push(match[1]);
	}
	return abbrs.sort();
}