import {writeFile, mkdir} from 'node:fs/promises';

// for some reason CLDR version != Unicode version
// also these files have garbage formatting

// note: i __refuse__ to load in some bloated XML library for parsing

async function fetch_regions(url, dir) {
	// A sequence of two Regional Indicator characters, where the corresponding ASCII characters 
	// are valid region sequences as specified by Unicode region subtags in [CLDR],
	// with idStatus = “regular”, “deprecated”, or “macroregion”.
	let res = await fetch(new URL('./common/validity/region.xml', url));
	if (res.status != 200) throw new Error(`HTTP error ${res.status}`);
	let text = await res.text();
	if (dir) {
		let file = new URL(`./region.xml`, dir);
		await writeFile(file, text);
		console.log(`Wrote: ${file}`);
	}
	text = text.replace(/<!--.*?-->/sg, ''); // remove comments
	let regions = [];
	for (let match of text.matchAll(/idStatus=(.)(.*?)\1[^\>]*\>(.*?)\<\/id\>/sg)) { // :X
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
	if (dir) {
		let file = new URL('./regions.json', dir);
		await writeFile(file, JSON.stringify(regions, null, '\t'));
		console.log(`Wrote: ${file}`);
	}
	return regions;
}

async function fetch_short_names(url, lang, dir) {
	let res = await fetch(new URL(`./common/annotations/${lang}.xml`, url));
	if (res.status != 200) throw new Error(`HTTP error ${res.status}`);
	let text = await res.text();
	// https://www.unicode.org/reports/tr35/tr35-45/tr35-general.html#Annotations
	// With an attribute type="tts", the value is a short name, such as one that can be 
	// used for text-to-speech. It should be treated as one of the element values for other purposes.
	// <annotation cp="🏻" >light skin tone | skin tone | type 1–2</annotation>
	// <annotation cp="🏻" type="tts">light skin tone</annotation>
	// Warnings: All cp values have U+FE0F characters removed. ???????????????????????
	if (dir) {
		let file = new URL(`./annotations-${lang}.xml`, dir);
		await writeFile(file, text);
		console.log(`Wrote: ${file}`);
	}
	let map = {};
	for (let match of text.matchAll(/<annotation cp="([^"]+)" type="tts">([^<]+)/sg)) {	// :X
		map[match[1]] = match[2];
	}
	console.log(`Found ${Object.keys(map).length} Short Names for "${lang}"`);
	if (dir) {
		let file = new URL(`./short-names.json`, dir);
		await writeFile(file, JSON.stringify(map, null, '\t'));
		console.log(`Wrote: ${file}`);
	}
	return map;
}

function url_for_version(version) {
	// wow this was 3-4 years old
	//return `https://raw.githubusercontent.com/unicode-org/cldr/latest/`; 
	return `https://raw.githubusercontent.com/unicode-org/cldr/release-${version}/`;
}

// https://cldr.unicode.org/index/downloads
// 20230412: v43
// 20221019: v42
// 20220406: v41
const version = 43;
let url = url_for_version(version);
let header = {version, url, date: new Date()};
console.log(header);

let out_dir = new URL(`./data/CLDR-${version}/`, import.meta.url);	
await mkdir(out_dir, {recursive: true});
await writeFile(new URL(`./version.json`, out_dir), JSON.stringify(header));
await fetch_regions(url, out_dir);
await fetch_short_names(url, 'en', out_dir);
