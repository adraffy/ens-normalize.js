import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {parse_version} from './utils.js';
import {fetch_UAX31_script_kinds} from './script-kinds.js';

//   latest: $ node download.js
//    draft: $ node download.js draft
// specific: $ node download.js 16.0.0

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

function urls_from_source(source, {major, minor = 0, patch = 0, draft}) {
	const UNICODE_BASE = `https://www.unicode.org/Public`;
	let bases = {
		SPEC: draft ? `${UNICODE_BASE}/draft/` : `${UNICODE_BASE}/${major}.${minor}.${patch}`,
		IDNA: draft ? `${UNICODE_BASE}/draft/idna/` : `${UNICODE_BASE}/idna/${major}.${minor}.${patch}`,
		EMOJI: draft ? `${UNICODE_BASE}/draft/emoji/` : `${UNICODE_BASE}/emoji/${major}.${minor}`,
		SECURITY: draft ? `${UNICODE_BASE}/draft/security` : `${UNICODE_BASE}/security/${major}.${minor}.${patch}`
	};
	return new URL(source.replace(/\{([A-Z]+)\}/g, (_, key) => {
		let base = bases[key];
		if (!base) throw new Error(`Unknown base: ${key}`);
		return base;
	}));
}

let force = false;
let use_draft = false;
let versions = process.argv.slice(2).filter(x => {
	if (x === '--force') {
		force = true;
	} else if (x === 'draft') {
		use_draft = true;
	} else {
		return true;
	}
}).map(parse_version);

if (!versions.length) {
	// if no version is provided
	// attempt to determine the latest version
	// by finding a version string in the UCD readme
	console.log(`Determining ${use_draft ? 'draft' : 'latest'} version...`);
	try {
		let res = await fetch(`https://www.unicode.org/Public/${use_draft ? 'draft' : 'UCD/latest'}/ReadMe.txt`);
		if (res.status != 200) throw new Error(`HTTP error ${res.status}`);
		let text = await res.text();
		let match = text.match(/Version (\d+\.\d+\.\d+)/);
		if (!match) throw new Error(`no match`);
		let version_str = match[1];
		console.log(`Latest version: ${version_str}`);
		let version = parse_version(version_str);
		if (use_draft) version.draft = true;
		versions.push(version);
	} catch (err) {
		throw new Error(`Unable to determine latest Unicode version: ${err.message}`);
	}
}

console.log({versions, force});

for (let version of versions) {
	await download(version);
}

async function download(version) {
	let version_str = `${version.major}.${version.minor}.${version.patch}`;
	let dir = new URL(`./data/${version_str}/`, import.meta.url);
	let changed = 0;
	let cause;
	console.log(`Downloading ${version_str} (${FILES.length} files)`);
	for (let sources of FILES) {
		let urls = sources.flatMap(s => urls_from_source(s, version));
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
			cause = err;
		}
	}
	// 20231023: include excluded/limited/recommended
	// shitty but these are now versioned with the spec
	try {
		let kinds = await fetch_UAX31_script_kinds(version_str);
		let name = `script-kinds.json`;
		await write(name, Buffer.from(JSON.stringify(kinds)), `<${name}>`);
	} catch (err) {
		cause = err;
	}
	if (!force && cause) throw new Error('incomplete download', {cause});
	console.log(`Changes: ${changed}`);
	const version_file = new URL('./version.json', dir);
	if (changed || await access(version_file).catch(() => true)) {
		// only bump the version if something changed
		await writeFile(version_file, JSON.stringify({version: version_str, ...version, date: new Date()}));	
		console.log(`Wrote: ${version_file}`);
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
