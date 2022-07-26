import {writeFile, mkdir} from 'fs/promises';
import {join} from 'path';
import {parse_cp, parse_cp_sequence, parse_cp_range} from './utils.js';
import {parse_semicolon_file} from './nodejs-utils.js';

let base_dir = new URL('.', import.meta.url).pathname;
let raw_dir = join(base_dir, 'unicode-raw');
let parsed_dir = join(base_dir, 'unicode-json');

await mkdir(parsed_dir, {recursive: true});
console.log(`Directory: ${parsed_dir}`);

async function write_simple_file(impl) {
	let {input, output} = impl;
	if (!output) output = input;
	try {
		let root = await parse_semicolon_file(join(raw_dir, `${input}.txt`), impl);
		//if (output === 'confusables') {
		await writeFile(join(parsed_dir, `${output}.json`), JSON.stringify(root));
		console.log(`Wrote: ${output}`);
		//}
		return root;
	} catch (cause) {
		console.error(cause);
		throw new Error(`error during ${input}`, {cause});
	}
}

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

await write_simple_file({
	input: 'DerivedNormalizationProps',
	output: 'QuickCheck',
	row([src, cls, state]) {
		if (cls.endsWith('_QC')) {
			this.get_bucket(cls).push([src, state]);
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

// dump out decimal digits
await write_simple_file({
	input: 'UnicodeData',
	output: 'DecimalDigits',
	row([src, _1, cat, _3, _4, _5, value]) {
		// if Nd then Decimal=Digit=Numeric
		if (cat === 'Nd') {
			this.get_bucket(value).push(src);
		}
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
	//root: [],
	row([src, dst]) {
		this.get_bucket(dst).push(src);
		//this.root.push([src, dst].map(x => String.fromCodePoint(...parse_cp_sequence(x))));
	}
});