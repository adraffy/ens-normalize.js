import {writeFile, mkdir} from 'node:fs/promises';

// for some reason CLDR version != Unicode version
// also these files have garbage formatting

async function fetch_regions(version) {
	// A sequence of two Regional Indicator characters, where the corresponding ASCII characters 
	//are valid region sequences as specified by Unicode region subtags in [CLDR],
	// with idStatus = “regular”, “deprecated”, or “macroregion”.
	let res = await fetch(`https://raw.githubusercontent.com/unicode-org/cldr/maint/maint-${version}/common/validity/region.xml`);
	if (res.status != 200) throw new Error(`HTTP error ${res.status}`);
	let text = await res.text();
	text = text.replace(/<!--.*?-->/sg, ''); // remove comments
	let regions = [];
	for (let match of text.matchAll(/idStatus=(.)(.*?)\1[^\>]*\>(.*?)\<\/id\>/sg)) {
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
	return regions;
}

const VERSION = '41';

let regions = await fetch_regions(VERSION);
console.log(`Regions: ${regions.length}`);

let out_dir = new URL(`./data/`, import.meta.url);	
await mkdir(out_dir, {recursive: true});
await writeFile(new URL('./regions.json', out_dir), JSON.stringify(regions, null, '\t'));
