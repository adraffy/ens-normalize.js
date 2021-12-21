import fetch from 'node-fetch';
import {writeFile, mkdir, access} from 'fs/promises';
import {join} from 'path';
import {createReadStream} from 'fs';
import {createInterface} from 'readline/promises';
import {parse_cp_sequence} from './utils.js';

// https://www.unicode.org/versions/latest/
const major = 14;
const minor = 0;
const patch = 0;

function url_for_spec(name) {
	return `https://www.unicode.org/Public/${major}.${minor}.${patch}/${name}`;
}
function url_for_idna(name) {
	return `https://www.unicode.org/Public/idna/${major}.${minor}.${patch}/${name}`;
}
function url_for_emoji(name) {
	return `https://unicode.org/Public/emoji/${major}.${minor}/${name}`;
}

let urls = [
	url_for_idna('IdnaMappingTable.txt'),
	url_for_idna('IdnaTestV2.txt'),

	url_for_spec('ucd/extracted/DerivedGeneralCategory.txt'),
	url_for_spec('ucd/extracted/DerivedCombiningClass.txt'),
	url_for_spec('ucd/extracted/DerivedJoiningType.txt'),
	url_for_spec('ucd/extracted/DerivedBidiClass.txt'),
	url_for_spec('ucd/extracted/DerivedDecompositionType.txt'),

	// note: this file lacks column names
	// https://www.unicode.org/Public/5.1.0/ucd/UCD.html#UnicodeData.txt
	url_for_spec('ucd/UnicodeData.txt'),

	url_for_spec('ucd/Scripts.txt'),
	//url_for_spec('ucd/Jamo.txt'), // not needed with algorithmic hangul
	url_for_spec('ucd/DerivedNormalizationProps.txt'),
	url_for_spec('ucd/NormalizationTest.txt'),
	url_for_spec('ucd/CompositionExclusions.txt'),

	url_for_emoji('emoji-sequences.txt'),
	url_for_emoji('emoji-zwj-sequences.txt'),
	url_for_emoji('emoji-test.txt'),
	url_for_spec('ucd/emoji/emoji-variation-sequences.txt'),
	url_for_spec('ucd/emoji/emoji-data.txt')
];

let base_dir = new URL('.', import.meta.url).pathname;
let downloaded_dir = join(base_dir, 'unicode-raw');
let parsed_dir = join(base_dir, 'unicode-json');

await main();

async function main() {
	if (process.argv.length < 3) {
		throw new Error('expected mode');
	}
	let [_0, _1, mode, ...argv] = process.argv;
	switch (mode) {
		case 'version': {
			console.log({major, minor, patch});
			return;
		}
		case 'download': return download(argv);
		case 'parse': return parse(argv);
		case 'run': {
			await download(argv);
			await parse(argv);
			return;
		}
		default: throw new Error(`unknown mode: ${mode}`);
	}
}

async function download(argv) {
	const skip = argv.includes('--skip');
	await mkdir(downloaded_dir, {recursive: true});
	console.log(`Directory: ${downloaded_dir}`);	
	// write a version file
	await writeFile(join(downloaded_dir, 'version.json'), JSON.stringify({major, minor, patch, date: new Date()}));
	// download the unicode shit
	await Promise.all(urls.map(async url => {
		let name = url.split('/').pop();
		let file = join(downloaded_dir, name);
		if (skip && !(await access(file).catch(() => true))) {
			console.log(`Skipped: ${name}`);
			return;
		}
		try {
			let res = await fetch(url);
			if (res.status != 200) throw new Error(`HTTP error ${res.status}`);
			let buf = await res.arrayBuffer();
			await writeFile(file, Buffer.from(buf));
			console.log(`Downloaded: ${url} => ${file}`);
		} catch (err) {
			console.log(`Download "${name}" failed: ${err.message}`);
		}
	}));
}

async function parse_semicolon_file(path, impl) {
	let scope = {
		root: {},
		...impl,
		get_bucket(key) {
			if (!key) throw new Error(`empty bucket key`);
			let bucket = root[key];
			if (!bucket) bucket = root[key] = [];
			return bucket;
		} 
	};
	let {root, row, comment} = scope;
	let rl = createInterface({input: createReadStream(path)});
	for await (let line of rl) {
		let rest;
		let pos = line.indexOf('#');
		if (pos >= 0) {
			rest = line.slice(pos + 1).trim();
			line = line.slice(0, pos).trim();
		}
		if (line) {
			row?.call(scope, line.split(';').map(s => s.trim()), rest);
		} else if (rest) {
			comment?.call(scope, rest);
		}
	}
	return root;
}


async function write_simple_file(impl) {
	let {input, output} = impl;
	if (!output) output = input;
	try {
		let root = await parse_semicolon_file(join(downloaded_dir, `${input}.txt`), impl);
		await writeFile(join(parsed_dir, `${output}.json`), JSON.stringify(root));
		console.log(`Wrote: ${output}`);
	} catch (cause) {
		console.error(cause);
		throw new Error(`error during ${input}`, {cause});
	}
}

function emoji_from_codes(s) {
	return String.fromCharCode(parse_cp_sequence);
}

async function parse(argv) {
	await mkdir(parsed_dir, {recursive: true});
	console.log(`Directory: ${parsed_dir}`);
	
	await write_simple_file({
		input: 'IdnaMappingTable',
		row([src, type, dst, status]) {
			if (!src) throw new Error('wtf src');
			if (status) type = `${type}_${status}`; // IDNA 2008 Status NV8/XV8
			let bucket = this.get_bucket(type);
			if (type.includes('mapped')) {
				if (!dst) throw new Error('wtf dst');
				bucket.push([src, dst]);
			} else {
				bucket.push(src); 
			}
		}
	});

	await write_simple_file({
		input: 'DerivedCombiningClass',
		row([src, cls]) {
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file({
		input: 'DerivedGeneralCategory',
		row([src, cls]) {
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file({
		input: 'DerivedJoiningType',
		row([src, cls]) {
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file({
		input: 'emoji-sequences',
		row([src, type, desc]) {
			this.get_bucket(type).push({hex: src, desc, emoji: String.fromCodePoint(...parse_cp_sequence(src))});
		}
	});

	// 1F468 200D 2764 FE0F 200D 1F468 ; RGI_Emoji_ZWJ_Sequence ; couple with heart: man, man
	await write_simple_file({
		input: 'emoji-zwj-sequences',
		root: [],
		row([src, _, desc]) {
			this.root.push({hex: src, desc, emoji: String.fromCodePoint(...parse_cp_sequence(src))});
		}
	});

	// 0023 FE0(E|F) ; text style;  # (1.1) NUMBER SIGN
	await write_simple_file({
		input: 'emoji-variation-sequences',
		row([src, style_desc]) {
			let v = parse_cp_sequence(src);
			if (v.length != 2) throw new Error('wtf length');
			let [cp, style] = v;
			switch (style) {
				case 0xFE0F: this.get_bucket('f').push(cp); break;
				case 0xFE0E: this.get_bucket('e').push(cp); break;
				default: throw new Error('wtf style');
			}
		}
	});

	// 1F691..1F693  ; Emoji # E0.6 [3] (🚑..🚓) ambulance..police car
	await write_simple_file({
		input: 'emoji-data',
		row([src, type]) {
			this.get_bucket(type).push(src);	
		}
	});

	await write_simple_file({
		input: 'DerivedBidiClass', 
		row([src, cls]) {
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file({
		input: 'DerivedDecompositionType',
		row([src, cls]) {
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file({
		input: 'DerivedNormalizationProps',
		row([src, cls, dst]) {
			if (dst === undefined) {
				this.get_bucket(cls).push(src);
			} else {
				this.get_bucket(cls).push([src, dst]);
			}
		}
	});

	await write_simple_file({
		input: 'UnicodeData',
		output: 'Decomposition_Mapping',
		root: [],
		row([src, _1, _2, _3, _4, decomp]) {
			// "" | "<tag>" | "XXXX YYYY" | "<tag>XXXX YYYY"
			// https://www.unicode.org/Public/5.1.0/ucd/UCD.html#Character_Decomposition_Mappings
			// "Conversely, the presence of a formatting tag also indicates that the mapping is a compatibility mapping and not a canonical mapping."
			if (!decomp || decomp.indexOf('>') >= 0) return;
			this.root.push([src, decomp]);
		}
	});

	await write_simple_file({
		input: 'CompositionExclusions',
		root: [],
		row([src]) {
			this.root.push(src);
		}
	});

	await write_simple_file({
		input: 'Scripts',
		row([codes, type]) {
			this.get_bucket(type).push(codes);
		}
	});

	/*
	await write_simple_file({
		input: 'Jamo',
		root: [],
		row([src, dst]) {
			this.root.push([src, dst]);
		}
	});
	*/

	// tests

	await write_simple_file({
		input: 'emoji-test', 
		row([codes, type]) {
			this.get_bucket(type).push({codes, emoji: emoji_from_codes(codes)});
		}
	});

	await write_simple_file({
		input: 'IdnaTestV2', 
		test: 'COMPAT',
		comment(s) {
			let match = s.match(/^([A-Z ]*) TESTS$/);
			if (match) {
				this.test = match[1].trim();
			}
		},
		row([src, toUnicode, status]) {
			let {test} = this;
			if (!test) throw new Error('expected test');
			status = status.split(/[\[\],]/).map(x => x.trim()).filter(x => x);
			this.get_bucket(this.test).push([src, toUnicode, status]);
		}
	});

	// why is this file so shit?
	// @Part0 # Test Name
	await write_simple_file({
		input: 'NormalizationTest',
		output: 'NormalizationTest',
		test: null,
		row([src, nfc, nfd], comment) {
			if (src.startsWith('@')) {
				this.test = comment.trim();
			} else {
				let {test} = this;
				if (!test) throw new Error('expected test');
				this.get_bucket(test).push([src, nfc, nfd]);
			}
		}	
	});

}