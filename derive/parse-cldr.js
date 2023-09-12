import {readFile, writeFile, mkdir} from 'node:fs/promises';

// for some reason CLDR version != Unicode version
// also these files have garbage formatting
// note: i __refuse__ to load in some bloated XML library for parsing
//
// 20230905: TODO migrate to cldr-json
// https://github.com/unicode-org/cldr-json#cldr-json
// why is this a npm package?

let versions = process.argv.slice(2);
// https://cldr.unicode.org/index/downloads
// 20220406: v41
// 20221019: v42
// 20230412: v43
// 20230903: v43.1

if (!versions.length) {
	// if no version is provided
	// attempt to determine the latest version
	// by finding the latest github release
	// note: this is shit
	try {
		const prefix = 'release-';
		let releases = await fetch('https://api.github.com/repos/unicode-org/cldr/releases').then(r => r.json());
		releases = releases.filter(x => !x.prerelease && !x.draft && x.name.startsWith(prefix) && !/(beta|alpha)/i.test(x.name));
		if (!releases.length) throw new Error('expected release');		
		let version = releases[0].name.slice(prefix.length).replaceAll('-', '.'); // assume sorted?
		versions.push(version);
		console.log(`Latest version: ${version}`);
	} catch (err) {
		throw new Error(`Unable to determine latest Unicode CLDR version: ${err.message}`);
	}
}

console.log(versions);

for (let version of versions) {
	await download(version);
}

async function download(version) {
	let dir = new URL(`./data/CLDR-${version}/`, import.meta.url);
	//let url = `https://raw.githubusercontent.com/unicode-org/cldr/latest/`; // wow this was 3-4 years old
	let base = `https://raw.githubusercontent.com/unicode-org/cldr/release-${version.replaceAll('.', '-')}`;
	const LANG = 'en';
	const regions_file = new URL('./region.xml', dir);
	const annotations_file = new URL(`./annotations-${LANG}.xml`, dir);
	let files = [
		{
			url: `${base}/common/validity/region.xml`,
			file: regions_file
		},
		{
			url: `${base}/common/annotations/${LANG}.xml`,
			file: annotations_file
		}
	];
	let changed = 0;
	console.log(`Downloading ${version} (${files.length} files)`);
	for (let {url, file} of files) {
		try {
			let res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP error ${res.status}`);
			let buf = Buffer.from(await res.arrayBuffer());
			let same;
			try {
				if (!Buffer.compare(await readFile(file), buf)) {
					same = true;
				}
			} catch (ignored) {	
			}
			if (!same) {
				changed++;
				await mkdir(dir, {recursive: true});
				await writeFile(file, buf);
			}
			console.log(`${same ? 'Same' : 'Downloaded'} <${url}>`);
		} catch (err) {
			console.log(url);
			console.log(err);
			throw new Error(`Download failed`);
		}
	}
	console.log(`Changes: ${changed}`);
	if (changed) {
		await write_json('regions', parse_regions(await readFile(regions_file, 'utf8')));
		await write_json('short-names', parse_short_names(await readFile(annotations_file, 'utf8')));
		await write_json('version', {version, url: base, date: new Date()});
	}
	async function write_json(name, json) {
		let file = new URL(`./${name}.json`, dir);
		await writeFile(file, JSON.stringify(json, null, '\t'));
		console.log(`Wrote: ${file}`);
	}
}

function parse_regions(xml) {
	// A sequence of two Regional Indicator characters, where the corresponding ASCII characters 
	// are valid region sequences as specified by Unicode region subtags in [CLDR],
	// with idStatus = “regular”, “deprecated”, or “macroregion”.
	xml = xml.replace(/<!--.*?-->/sg, ''); // remove comments
	let regions = [];
	for (let match of xml.matchAll(/idStatus=(.)(.*?)\1[^\>]*\>(.*?)\<\/id\>/sg)) { // :X
		switch (match[2]) {
			case 'regular':
			//case 'deprecated': // 20220922: these dont have platform support
			case 'macroregion': break;
			default: continue;
		}
		for (let s of match[3].split(/\s+/)) {
			s = s.trim();
			let match = s.match(/^([A-Z]{2})(~([A-Z]))?$/);
			if (!match) continue;
			let start = match[1];
			let range = match[3];
			if (range) {
				let a = start.charCodeAt(0);
				let b = start.charCodeAt(1);
				let c = range.charCodeAt(0);
				for (let i = b; i <= c; i++) {
					regions.push(String.fromCharCode(a, i));
				}
 			} else {
				regions.push(start);
			}
		}
	}
	regions.sort();
	console.log(`Found ${regions.length} Region Codes`);
	return regions;
}

function parse_short_names(xml) {
	// https://www.unicode.org/reports/tr35/tr35-45/tr35-general.html#Annotations
	// With an attribute type="tts", the value is a short name, such as one that can be 
	// used for text-to-speech. It should be treated as one of the element values for other purposes.
	// <annotation cp="🏻" >light skin tone | skin tone | type 1–2</annotation>
	// <annotation cp="🏻" type="tts">light skin tone</annotation>
	// Warnings: All cp values have U+FE0F characters removed. ???????????????????????
	let map = {};
	for (let match of xml.matchAll(/<annotation cp="([^"]+)" type="tts">([^<]+)/sg)) {	// :X
		map[match[1]] = match[2];
	}
	console.log(`Found ${Object.keys(map).length} Short Names`);
	return map;
}
