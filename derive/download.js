import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {parse_version} from './utils.js';
import {fetch_UAX31_script_kinds} from './script-kinds.js';

const FILES = [
	// UCD
	['{SPEC}/ucd/UnicodeData.txt'],
	['{SPEC}/ucd/PropList.txt'],
	['{SPEC}/ucd/DerivedCoreProperties.txt'],
	// IDNA
	['{IDNA}/IdnaMappingTable.txt'],
	['{IDNA}/IdnaTestV2.txt', /*old*/'{IDNA}/IdnaTest.txt'],
	// NF
	['{SPEC}/ucd/CompositionExclusions.txt'],
	['{SPEC}/ucd/DerivedNormalizationProps.txt'],
	['{SPEC}/ucd/NormalizationTest.txt'],
	// Emoji
	['{SPEC}/ucd/emoji/emoji-data.txt', /*old*/'{EMOJI}/emoji-data.txt'],
	['{EMOJI}/emoji-sequences.txt'],
	['{EMOJI}/emoji-zwj-sequences.txt'],
	['{EMOJI}/emoji-test.txt'],
	// Confusables
	['{SPEC}/ucd/Scripts.txt'],
	['{SPEC}/ucd/ScriptExtensions.txt'],
	['{SPEC}/ucd/PropertyValueAliases.txt'],
	['{SECURITY}/confusables.txt'],
	['{SECURITY}/IdentifierStatus.txt'],
	['{SECURITY}/IdentifierType.txt'],
	['{SECURITY}/intentional.txt'],
];

function url_from_source(source, {major, minor = 0, patch = 0}) {
	const UNICODE_BASE = `https://www.unicode.org/Public`;
	let bases = {
		'SPEC': `${UNICODE_BASE}/${major}.${minor}.${patch}`,
		'IDNA': `${UNICODE_BASE}/idna/${major}.${minor}.${patch}`,
		'EMOJI': `${UNICODE_BASE}/emoji/${major}.${minor}`,
		'SECURITY': `${UNICODE_BASE}/security/${major}.${minor}.${patch}`,
	};
	return new URL(source.replace(/\{([A-Z]+)\}/g, (_, key) => {
		let base = bases[key];
		if (!base) throw new Error(`Unknown base: ${key}`);
		return base;
	}));
}

let versions = process.argv.slice(2).map(parse_version);

if (!versions.length) {
	// if no version is provided
	// attempt to determine the latest version
	// by finding a version string in the UCD readme
	console.log(`Determining latest version...`);
	try {
		let res = await fetch('https://www.unicode.org/Public/UCD/latest/ReadMe.txt');
		if (res.status != 200) throw new Error(`HTTP error ${res.status}`);
		let text = await res.text();
		let match = text.match(/Version (\d+\.\d+\.\d+)/);
		if (!match) throw new Error(`no match`);
		let version = match[1];
		console.log(`Latest version: ${version}`);
		versions.push(parse_version(version));
	} catch (err) {
		throw new Error(`Unable to determine latest Unicode version: ${err.message}`);
	}
}

console.log(versions);

for (let version of versions) {
	await download(version, FILES);
}

async function download({major, minor, patch}, files) {
	let version = `${major}.${minor}.${patch}`;
	let dir = new URL(`./data/${major}.${minor}.${patch}/`, import.meta.url);
	let changed = 0;
	let error;
	console.log(`Downloading ${version} (${files.length} files)`);
	for (let sources of files) {
		let urls = sources.map(s => url_from_source(s, {major, minor, patch}));
		try {
			let [i, buf] = await Promise.any(urls.map(async (url, i) => {
				let res = await fetch(url);
				if (!res.ok) throw new Error(`HTTP error ${res.status}`);
				return [i, Buffer.from(await res.arrayBuffer())];
			}));
			let name = urls[i].pathname.split('/').pop();
			await write(name, buf, `<${urls[i]}> [${i+1}/${sources.length}]`);
		} catch (err) {
			if (err instanceof AggregateError) {
				for (let i = 0; i < sources.length; i++) {
					console.log(`FAIL <${urls[i]}> [${i+1}/${sources.length}] => ${err.errors[i].message}`);
				}
			} else {
				throw err;
			}
			error = true;
		}
	}
	// 20231023: include excluded/limited/recommended
	// shitty but these are now versioned with the spec
	try {
		let kinds = await fetch_UAX31_script_kinds(version);
		let name = `script-kinds.json`;
		await write(name, Buffer.from(JSON.stringify(kinds)), `<${name}>`);
	} catch (err) {
		error = true;
	}
	if (error) throw new Error('incomplete download');	
	console.log(`Changes: ${changed}`);
	if (changed) {
		// only bump the version if something changed
		let file = new URL('./version.json', dir);
		await writeFile(file, JSON.stringify({version, major, minor, patch, date: new Date()}));	
		console.log(`Wrote: ${file}`);
	}
	async function write(name, buf, desc) {
		let file = new URL(name, dir);
		let same;
		try {
			same = !Buffer.compare(await readFile(file), buf);
		} catch (ignored) {	
		}
		if (!same) {
			changed++;
			await mkdir(dir, {recursive: true});
			await writeFile(file, buf);
		}
		console.log(`${same ? 'SAME' : 'NEW!'} ${desc}`);
	}
}
