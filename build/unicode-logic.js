import {read_parsed} from './nodejs-utils.js';
import {parse_cp_range, parse_cp_sequence, parse_cp_multi_ranges, map_values, is_subset, set_complement} from './utils.js';

export function read_idna_rules({use_STD3 = true, version = 2008, valid_deviations = false}) {
	let {
		ignored,
		mapped,
		valid, 
		valid_NV8,
		valid_XV8,
		deviation_mapped,
		deviation_ignored,
		disallowed,
		disallowed_STD3_mapped,
		disallowed_STD3_valid,
		...extra
	} = read_parsed('IdnaMappingTable');
	if (Object.keys(extra).length > 0) {
		throw new Error(`Assumption wrong: Unknown IDNA Keys: ${Object.keys(extra)}`);
	}
	if (!use_STD3) {
		// disallowed_STD3_valid: the status is disallowed if UseSTD3ASCIIRules=true (the normal case); 
		// implementations that allow UseSTD3ASCIIRules=false would treat the code point as valid.
		valid.push(...disallowed_STD3_valid);
		// disallowed_STD3_mapped: the status is disallowed if UseSTD3ASCIIRules=true (the normal case); 
		// implementations that allow UseSTD3ASCIIRules=false would treat the code point as mapped.
		mapped.push(...disallowed_STD3_mapped);
	}
	if (version == 2003) {
		// There are two values: NV8 and XV8. NV8 is only present if the status is valid 
		// but the character is excluded by IDNA2008 from all domain names for all versions of Unicode. 
		valid.push(...valid_NV8);
		// XV8 is present when the character is excluded by IDNA2008 for the current version of Unicode.
		valid.push(...valid_XV8);
	} 
	// IDNA2008 allows the joiner characters (ZWJ and ZWNJ) in labels. 
	// By contrast, these are removed by the mapping in IDNA2003.
	if (version == 2008 || valid_deviations) { 
		valid.push(...deviation_mapped.map(([x]) => x));
		valid.push(...deviation_ignored);
	} else {
		mapped.push(...deviation_mapped);
		ignored.push(...deviation_ignored);
	}
	valid = new Set(valid.flatMap(parse_cp_range));
	ignored = new Set(ignored.flatMap(parse_cp_range));
	// x:[char] => ys:[char, char, ...]
	mapped = mapped.flatMap(([src, dst]) => {
		let cps = parse_cp_sequence(dst);
		// we need to re-apply the rules to the mapped output
		return cps.some(cp => ignored.has(cp) || !valid.has(cp)) ? [] : parse_cp_range(src).map(x => [x, cps]);
	});
	return {valid, ignored, mapped, use_STD3, version, valid_deviations};
}

// this probably should be sets
export function read_emoji_data() {
	return {
		// Emoji
		// Emoji_Presentation
		// Emoji_Modifier
		// Emoji_Modifier_Base
		// Emoji_Component
		// Extended_Pictographic
		...map_values(read_parsed('emoji-data'), e => e.flatMap(parse_cp_range)),
		// these exist in emoji-data
		// but can only be identified 
		// by parsing the comments
		keycaps: parse_cp_multi_ranges('23 2A 30..39'),
		regional: parse_cp_multi_ranges('1F1E6..1F1FF'),
		tag_spec: parse_cp_multi_ranges('E0020..E007E')
	};
}

export function read_combining_marks() {
	return new Set(Object.entries(read_parsed('DerivedGeneralCategory'))
		.filter(([k]) => k.startsWith('M'))
		.flatMap(([_, v]) => v.flatMap(parse_cp_range)));
}

export function read_bidi_rules() {
	let src = read_parsed('DerivedBidiClass');
	let ret = {};
	for (let key of ['R', 'L', 'AL', 'AN', 'EN', 'ES', 'CS', 'ET', 'ON', 'BN', 'NSM']) {
		let v = src[key];
		if (!v) throw new Error(`Assumption wrong: Expected Bidi Class ${key}`);
		ret[key] = v.flatMap(parse_cp_range);
	}
	return ret;
}

export function read_context_joining_types() {
	let src = read_parsed('DerivedJoiningType');
	let ret = {};
	for (let key of ['T', 'L', 'R', 'D']) {
		let v = src[key];
		if (!v) throw new Error(`Assumption wrong: expected Context Joining Type: ${key}`);
		ret[key] = v.flatMap(parse_cp_range);
	}
	return ret;
}


// https://www.unicode.org/reports/tr39/#Mixed_Script_Detection
const SCRIPT_EXT_TR39 = {
	'Hani': ['Hanb', 'Jpan', 'Kore'],
	'Hira': ['Jpan'],
	'Kana': ['Jpan'],
	'Hang': ['Kore'],
	'Bopo': ['Hanb']
};
export function expand_abbrs(abbrs) {
	let set = new Set(abbrs);
	for (let [x, ys] of Object.entries(SCRIPT_EXT_TR39)) {
		if (set.has(x)) {
			for (let x of ys) {
				set.add(x);
			}
		}
	} 
	return [...set];
}

// https://www.unicode.org/reports/tr31/#Table_Recommended_Scripts
export const RECOMMENDED_SCRIPTS = [
	'Zyyy', // Common
	'Zinh', // Inherited
	'Arab', // Arabic
	'Armn', // Armenian
	'Beng', // Bengali
	'Bopo', // Bopomofo
	'Cyrl', // Cyrillic
	'Deva', // Devanagari
	'Ethi', // Ethiopic
	'Geor', // Georgian
	'Grek', // Greek
	'Gujr', // Gujarati
	'Guru', // Gurmukhi
	'Hang', // Hangul
	'Hani', // Han
	'Hebr', // Hebrew
	'Hira', // Hiragana
	'Kana', // Katakana
	'Knda', // Kannada
	'Khmr', // Khmer
	'Laoo', // Lao
	'Latn', // Latin
	'Mlym', // Malayalam
	'Mymr', // Myanmar
	'Orya', // Oriya
	'Sinh', // Sinhala
	'Taml', // Tamil
	'Telu', // Telugu
	'Thaa', // Thaana
	'Thai', // Thai
	'Tibt', // Tibetan	
];

export function read_script_sets({level, skip_extensions, remove_subsets} = {}) {
	
	const ALL = 'ALL';
	const NAME_TO_ABBR = Object.fromEntries(Object.entries(read_parsed('PropertyValueAliases').sc).map(v => v.reverse()));

	let cp_to_abbr = {};
	for (let [script, ranges] of Object.entries(read_parsed('Scripts'))) {
		let abbr;
		if (script === 'Common' || script === 'Inherited') {
			abbr = ALL;
		} else {
			abbr = NAME_TO_ABBR[script];
			if (!abbr) throw new Error(`Unknown script: ${script}`);
		}
		for (let cp of ranges.flatMap(parse_cp_range)) {
			cp_to_abbr[cp] = abbr;
		}
	}

	if (!skip_extensions) {
		for (let [range, abbrs] of Object.entries(read_parsed('ScriptExtensions'))) {
			abbrs = expand_abbrs(abbrs);
			for (let cp of parse_cp_range(range)) {
				let old = cp_to_abbr[cp];
				if (!old) throw new Error(`Missing script: ${cp}`);
				if (typeof old !== 'string') throw new Error(`Duplicate: ${cp}`);
				if (old !== ALL && !abbrs.includes(old)) throw new Error(`Disunion: ${cp}`);
				cp_to_abbr[cp] = abbrs;
			}
		}
	}

	let abbr_to_cps = {};
	for (let [cp, abbrs] of Object.entries(cp_to_abbr)) {
		if (typeof abbrs === 'string') {
			// All code points not explicitly listed for Script_Extensions
			// have as their value the corresponding Script property value
			abbrs = expand_abbrs([abbrs]);
		}
		cp = parseInt(cp);
		for (let abbr of abbrs) {
			let bucket = abbr_to_cps[abbr];
			if (!bucket) abbr_to_cps[abbr] = bucket = new Set();
			bucket.add(cp);
		}
	}

	function req_abbr(abbr) {
		let cps = abbr_to_cps[abbr];
		if (!cps) throw new Error(`Expected script: ${abbr}`);
		return cps;
	}

	function latin_plus(abbr) {
		abbr_to_cps[`Latn_${abbr}`] = new Set([...req_abbr('Latn'), ...req_abbr(abbr)]);
	}

	if (level >= 3) {
		// https://www.unicode.org/reports/tr39/#highly_restrictive
		// The string is covered by any of the following sets of scripts, according to the definition in Section 5.1: 
		// Latin + Han + Hiragana + Katakana; or equivalently: Latn + Jpan
		// Latin + Han + Bopomofo; or equivalently: Latn + Hanb
		// Latin + Han + Hangul; or equivalently: Latn + Kore
		for (let abbr of ['Jpan', 'Hanb', 'Kore']) {
			latin_plus(abbr);
		}
	}

	if (level >= 4) {
		// https://www.unicode.org/reports/tr39/#moderately_restrictive
		// The string is covered by Latin and any one other Recommended script, except Cyrillic, Greek
		// Remove: Cyrl, Grek, Latn, Zyyy, Zinh 
		for (let abbr of set_complement(RECOMMENDED_SCRIPTS, ['Latn', 'Zyyy', 'Zinh', 'Cyrl', 'Grek'])) {
			latin_plus(abbr);
		}
	}

	if (remove_subsets) {
		// remove any script thats fully contained in another script
		let v = Object.entries(abbr_to_cps);
		for (let i = 1; i < v.length; i++) {
			let seti = v[i][1];
			for (let j = 0; j < i; j++) {
				let [key, setj] = v[j];
				if (is_subset(seti, setj)) {
					console.log(`Removed subset: ${key}`);
					delete abbr_to_cps[key];
					break;
				}
			}
		}
	}

	return abbr_to_cps;
}

export function all_codepoints() {
	/*
	let v = [];
	for (let cp = 0; cp <= 0x10FFFF; cp++) {
		try {
			String.fromCodePoint(cp);
			v.push(cp);
		} catch (err) {	
		}
	}
	*/
	return Array(0x110000).fill().map((_, i) => i);	
}
