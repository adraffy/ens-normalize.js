import {read_parsed} from './nodejs-utils.js';
import {parse_cp_range, parse_cp_sequence, parse_cp_multi_ranges, map_values} from './utils.js';

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

export function read_emoji_data() {
	return {
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

//https://www.unicode.org/reports/tr39/#Mixed_Script_Detection
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

export function read_script_sets() {

	
	const ALL = 'ALL';
	const NAME_TO_ABBR = Object.fromEntries(Object.entries(read_parsed('PropertyValueAliases').sc).map(v => v.reverse()));

	let cp_to_abbr = {};
	for (let [script, ranges] of Object.entries(read_parsed('Scripts'))) {
		let abbr;
		if (script === 'Common' || script === 'Inherited') {
			abbr = ALL;
		} else {
			abbr = NAME_TO_ABBR[script];
			if (!abbr) throw new Error(`Assumption: unknown script: ${script}`);
		}
		for (let cp of ranges.flatMap(parse_cp_range)) {
			cp_to_abbr[cp] = abbr;
		}
	}

	for (let [range, abbrs] of Object.entries(read_parsed('ScriptExtensions'))) {
		abbrs = expand_abbrs(abbrs);
		for (let cp of parse_cp_range(range)) {
			let old = cp_to_abbr[cp];
			if (!old) throw new Error(`Assumption: missing script: ${cp}`);
			if (typeof old !== 'string') throw new Error(`Assumption: duplicate: ${cp}`);
			if (old !== ALL && !abbrs.includes(old)) throw new Error(`Assumption: disunion: ${cp}`);
			cp_to_abbr[cp] = abbrs;
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
			let list = abbr_to_cps[abbr];
			if (!list) abbr_to_cps[abbr] = list = [];		
			list.push(cp);
		}
	}

	return abbr_to_cps;
}
