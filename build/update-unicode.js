import fetch from 'node-fetch';
import {writeFile, mkdir, access} from 'fs/promises';
import {join} from 'path';
import {parse_cp, parse_cp_sequence, parse_cp_range} from './utils.js';
import {parse_semicolon_file} from './nodejs-utils.js';

// https://www.unicode.org/versions/latest/
const major = 14;
const minor = 0;
const patch = 0;

function url_for_public(s) {
	return `https://www.unicode.org/Public/${s}`;
}
function url_for_spec(s) {
	return url_for_public(`${major}.${minor}.${patch}/${s}`);
}
function url_for_idna(s) {
	return url_for_public(`idna/${major}.${minor}.${patch}/${s}`);
}
function url_for_emoji(s) {
	return url_for_public(`emoji/${major}.${minor}/${s}`);
}
function url_for_security(s) {
	return url_for_public(`/security/${major}.${minor}.${patch}/${s}`);
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
	url_for_spec('ucd/ScriptExtensions.txt'),
	url_for_spec('ucd/PropertyValueAliases.txt'),

	//url_for_spec('ucd/Jamo.txt'), // not needed with algorithmic hangul
	url_for_spec('ucd/DerivedNormalizationProps.txt'),
	url_for_spec('ucd/NormalizationTest.txt'),
	url_for_spec('ucd/CompositionExclusions.txt'),

	url_for_emoji('emoji-sequences.txt'),
	url_for_emoji('emoji-zwj-sequences.txt'),
	url_for_emoji('emoji-test.txt'),
	url_for_spec('ucd/emoji/emoji-variation-sequences.txt'),
	url_for_spec('ucd/emoji/emoji-data.txt'),

	url_for_security('confusables.txt'),

	// alternative names
	// note: this isn't versioned by url
	url_for_public('UNIDATA/NamesList.txt')
];

let base_dir = new URL('.', import.meta.url).pathname;
let downloaded_dir = join(base_dir, 'unicode-raw');
let parsed_dir = join(base_dir, 'unicode-json');

await main();

async function main() {
	let [mode, ...argv] = process.argv.slice(2);
	switch (mode) {
		case 'version': {
			console.log({major, minor, patch});
			return;
		}
		case 'download': return download(argv);
		case 'parse': return parse(argv);
		case undefined: {
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


async function write_simple_file(impl) {
	let {input, output} = impl;
	if (!output) output = input;
	try {
		let root = await parse_semicolon_file(join(downloaded_dir, `${input}.txt`), impl);
		//if (output === 'ScriptExtensions' || output == 'PropertyValueAliases') {
		await writeFile(join(parsed_dir, `${output}.json`), JSON.stringify(root));
		console.log(`Wrote: ${output}`);
		//}
		return root;
	} catch (cause) {
		console.error(cause);
		throw new Error(`error during ${input}`, {cause});
	}
}

async function parse(argv) {
	await mkdir(parsed_dir, {recursive: true});
	console.log(`Directory: ${parsed_dir}`);

	await write_simple_file({
		input: 'IdnaMappingTable',
		row([src, type, dst, status]) {
			if (!src) throw new Error('wtf src');
			if (type == 'deviation') type = dst ? 'deviation_mapped' : 'deviation_ignored';
			if (status) type = `${type}_${status}`; // NV8/XV8
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

	// 1F691..1F693  ; Emoji # E0.6 [3] (🚑..🚓) ambulance..police car
	// this file is shit because Emoji_Component is not broken down
	let {Emoji_Component: emoji_comp} = await write_simple_file({
		input: 'emoji-data',
		row([src, type]) {
			this.get_bucket(type).push(src);	
		}
	});
	emoji_comp = new Set(emoji_comp.flatMap(parse_cp_range));
	
	// kludge: missing emoji data
	// 1F1E6;REGIONAL INDICATOR SYMBOL LETTER A;So;0;L;;;;;N;;;;;
	// E0061;TAG LATIN SMALL LETTER A;Cf;0;BN;;;;;N;;;;;
	await write_simple_file({
		input: 'UnicodeData',
		output: 'emoji-missing',
		row([src, name]) {
			src = parse_cp(src);
			if (name.startsWith('REGIONAL INDICATOR SYMBOL') && emoji_comp.has(src)) {
				this.get_bucket('regional').push(src);
			} else if (name.startsWith('TAG') && emoji_comp.has(src)) {
				this.get_bucket('tag_spec').push(src);
			} 
		}
	});

	// 2695 FE0F ; Basic_Emoji ; medical symbol # E4.0 [1] (⚕️)
	await write_simple_file({
		input: 'emoji-sequences',
		row([src, type, desc]) {
			this.get_bucket(type).push({src, desc});
		}
	});

	// 1F468 200D 2764 FE0F 200D 1F468 ; RGI_Emoji_ZWJ_Sequence ; couple with heart: man, man
	await write_simple_file({
		input: 'emoji-zwj-sequences',
		root: [],
		row([src, type, desc]) {
			if (type != 'RGI_Emoji_ZWJ_Sequence') throw new Error('wtf type');
			this.root.push({src, desc});
		}
	});

	// 0023 FE0(E|F) ; text style; # (1.1) NUMBER SIGN
	await write_simple_file({
		input: 'emoji-variation-sequences',
		row([src]) {
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

	// note: this file lacks an inline description
	// https://www.unicode.org/reports/tr44/#UnicodeData.txt
	// 0000;<control>;Cc;0;BN;;;;;N;NULL;;;;
	await write_simple_file({
		input: 'UnicodeData',
		output: 'Decomposition_Mapping',
		root: [],
		row([src, _1, _2, _3, _4, decomp]) {
			// https://www.unicode.org/Public/5.1.0/ucd/UCD.html#Character_Decomposition_Mappings
			// "Conversely, the presence of a formatting tag also indicates that the mapping is a compatibility mapping and not a canonical mapping."
			// "" | "<tag>" | "XXXX YYYY" | "<tag>XXXX YYYY"
			if (!decomp || decomp.indexOf('>') >= 0) return;
			this.root.push([src, decomp]);
		}
	});
	await write_simple_file({
		input: 'UnicodeData',
		output: 'Names',
		row([src, name]) {
			this.root[parse_cp(src)] = name;
		}
	});

	// note: these are all single chars
	// 0958 #  DEVANAGARI LETTER QA
	await write_simple_file({
		input: 'CompositionExclusions',
		root: [],
		row([src]) {
			this.root.push(src);
		}
	});

	// 0000..001F ; Common # Cc  [32] <control-0000>..<control-001F>
	await write_simple_file({
		input: 'Scripts',
		row([codes, type]) {
			this.get_bucket(type).push(codes);
		}
	});

	// 102E0         ; Arab Copt # Mn       COPTIC EPACT THOUSANDS MARK
	await write_simple_file({
		input: 'ScriptExtensions',
		row([src, keys]) {
			this.root[src] = keys.split(' ');
		}
	});

	// sc ; Adlm                             ; Adlam
	await write_simple_file({
		input: 'PropertyValueAliases',
		row([group, key, value]) {
			let bucket = this.root[group];
			if (!bucket) this.root[group] = bucket = {};
			bucket[key] = value;
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

	// 1F44C 1F3FB ; fully-qualified # 👌🏻 E1.0 OK hand: light skin tone
	await write_simple_file({
		input: 'emoji-test', 
		row([src, type]) {
			this.get_bucket(type).push(src);
		}
	});

	/*
	# Column 1: source -          The source string to be tested
	# Column 2: toUnicode -       The result of applying toUnicode to the source,
	#                             with Transitional_Processing=false.
	#                             A blank value means the same as the source value.
	# Column 3: toUnicodeStatus - A set of status codes, each corresponding to a particular test.
	#                             A blank value means [] (no errors).
	# Column 4: toAsciiN -        The result of applying toASCII to the source,
	#                             with Transitional_Processing=false.
	#                             A blank value means the same as the toUnicode value.
	# Column 5: toAsciiNStatus -  A set of status codes, each corresponding to a particular test.
	#                             A blank value means the same as the toUnicodeStatus value.
	#                             An explicit [] means no errors.
	# Column 6: toAsciiT -        The result of applying toASCII to the source,
	#                             with Transitional_Processing=true.
	#                             A blank value means the same as the toAsciiN value.
	# Column 7: toAsciiTStatus -  A set of status codes, each corresponding to a particular test.
	#                             A blank value means the same as the toAsciiNStatus value.
	#                             An explicit [] means no errors.
	*/
	// xn--fa-hia.de; faß.de; ; xn--fa-hia.de; ; ;  # faß.de
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
	/*
	#   Columns (c1, c2,...) are separated by semicolons
	#   They have the following meaning:
	#      source; NFC; NFD; NFKC; NFKD
	#   Comments are indicated with hash marks
	#   Each of the columns may have one or more code points.
	*/
	// 1E0A;1E0A;0044 0307;1E0A;0044 0307; # (Ḋ; Ḋ; D◌̇; Ḋ; D◌̇; ) LATIN CAPITAL LETTER D WITH DOT ABOVE
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
				this.get_bucket(test).push([src, nfc, nfd].map(s => String.fromCodePoint(...parse_cp_sequence(s))));
			}
		}	
	});

	// 05AD ;	0596 ;	MA	# ( ֭ → ֖ ) HEBREW ACCENT DEHI → HEBREW ACCENT TIPEHA	# 
	// Field 1 is the source, Field 2 is the target, 
	// Field 3 is obsolete, always containing the letters “MA” for backwards compatibility. 
	await write_simple_file({
		input: 'confusables',
		row([src, dst]) {
			this.get_bucket(dst).push(src);
		}
	});




}