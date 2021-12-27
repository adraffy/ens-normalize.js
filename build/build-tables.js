import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {Encoder, is_better_member_compression, base64} from './encoder.js';
import {
	parse_cp, parse_cp_range, parse_cp_sequence, parse_cp_multi_ranges,
	map_values, take_from, set_union, set_intersect, split_ascending, hex_cp, split_on, group_by, compare_arrays
} from './utils.js';
import {read_parsed} from './nodejs-utils.js';

let base_dir = new URL('./', import.meta.url).pathname;

function ensure_dir(name) {
	let dir = join(base_dir, name);
	mkdirSync(dir, {recursive: true});
	return dir;
}

class IDNA {
	constructor() {
		this.valid = new Set();
		this.ignored = new Set();
		this.mapped = [];
	}
	remove_rule(cp) {
		if (this.ignored.delete(cp)) return true;
		if (this.valid.delete(cp)) return true;
		let pos = this.mapped.findIndex(([x]) => cp == x);
		if (pos >= 0) {
			this.mapped.splice(pos, 1);
			return true;
		}
		return false;
	}
	is_disallowed(cp) {
		return !this.valid.has(cp) && !this.ignored.has(cp) && !this.mapped.some(([x]) => x == cp);
	}
	check_invariants() {
		// everything in the mapped output should be valid
		for (let [x, ys] of this.mapped) {
			if (this.valid.has(x)) {
				throw new Error(`Invalid rules: mapped target is valid: ${x}`);
			}
			if (this.ignored.has(x)) {
				throw new Error(`Invalid rules: mapped target is ignored: ${x}`);
			}
  			if (!ys.every(cp => this.valid.has(cp))) {
				throw new Error(`Invalid rules: mapped output isn't valid: ${x} -> ${ys}`);
			}
		}
		if (set_intersect(this.valid, this.ignored).size > 0) {
			throw new Error(`Invalid rules: valid intersects ignored`);
		}
	}
	check_uts46_assumptions() {
		// check some assumptions:
		// 1.) emoji styling should be ignored
		if (!this.ignored.has(0xFE0E)) throw new Error('Assumption wrong: FE0E not ignored');
		if (!this.ignored.has(0xFE0F)) throw new Error('Assumption wrong: FE0F not ignored');		
		// 2.) joiners should be valid if using context rules
		// note: this doesn't impact emoji zwj processing
		if (!this.valid.has(0x200C)) throw new Error('Assumption wrong: ZWNJ not valid');
		if (!this.valid.has(0x200D)) throw new Error('Assumption wrong: ZWJ not valid');
	}
}

class UTS51 {
	constructor(data) {
		this.STYLE_DROP = new Set();
		this.STYLE_OPT = new Set();
		this.STYLE_REQ = new Set();
		this.NON_SOLO = new Set(); // TODO: use this to allow 1F233 inside of a ZWJ sequence
		this.KEYCAP_DROP = new Set();
		this.KEYCAP_REQ = new Set();
		this.REGIONAL = new Set();
		this.TAG_SPEC = new Set();
		this.MOD_BASE = new Set();
		this.MODIFIER = new Set();
		//let emoji_MAP = {};
		//this.data = data;
		this.emoji = new Set(data.Emoji);
		this.zwj = data.zwj;
		this.picto = data.Extended_Pictographic.filter(cp => !this.emoji.has(cp));
		// check that Emoji_Presentation is a subset of emoji
		if (data.Emoji_Presentation.some(cp => !this.emoji.has(cp))) {
			throw new Error(`Assumption wrong: Emoji_Presentation not emoji`);
		}
		// check that Emoji_Modifier_Base is a subset of emoji
		if (data.Emoji_Modifier_Base.some(cp => !this.emoji.has(cp))) {
			throw new Error(`Assumption wrong: Emoji_Modifier_Base not emoji`);
		}
		// check that Emoji_Modifier is a subset of emoji
		if (data.Emoji_Modifier.some(cp => !this.emoji.has(cp))) {
			throw new Error(`Assumption wrong: Emoji_Modifier are emoji`);
		}
		// start with all the emoji as optional
		for (let cp of this.emoji) {
			this.STYLE_OPT.add(cp);
		}
		// assign modifier_base
		for (let cp of data.Emoji_Modifier_Base) {
			this.MOD_BASE.add(cp);
		}
		// assign modifier
		for (let cp of data.Emoji_Modifier) {
			this.MODIFIER.add(cp);
		}
		// assign regional
		for (let cp of data.regional) {
			this.remove_style(cp);
			this.REGIONAL.add(cp); 
		}
		// assign tag spec
		for (let cp of data.tag_spec) {
			this.TAG_SPEC.add(cp);
		}
		// assign keycaps
		for (let cp of data.keycaps) {
			this.KEYCAP_REQ.add(cp);
		}
	}
	set_style(cp, key) {
		if (!this.emoji.has(cp)) throw new Error(`styling a non-emoji: ${cp}`);
		this.remove_style(cp);
		switch (key) {
			case 'style-req': this.STYLE_REQ.add(cp); break;
			case 'style-opt': this.STYLE_OPT.add(cp); break;
			case 'style-drop': this.STYLE_DROP.add(cp); break;
			default: throw new Error(`unknown style: ${key}`);
		}
	}
	remove_style(cp) {
		if (this.STYLE_DROP.delete(cp)) return true;
		if (this.STYLE_OPT.delete(cp)) return true;
		if (this.STYLE_REQ.delete(cp)) return true;
		return false;
	}
	group_zwj() {
		// we dont include STYLE_REQ because we're dropping FE0F
		let valid_set = set_union(this.STYLE_DROP, this.STYLE_OPT); 
		let valid_idx = [...valid_set].sort((a, b) => a - b);
		let groups = {};
		for (let seq of this.zwj) {
			let parts = split_on(seq.filter(cp => cp != 0xFE0F), 0x200D);
			if (parts.length == 0) {
				throw new Error(`Assumption wrong: ZWJ sequence without ZWJ`);
			}
			let cps = parts.flat();
			if (cps.some(cp => !valid_set.has(cp))) {
				console.log(cps);
				throw new Error(`Assumption wrong: ZWJ sequence contains invalid emoji`);
			}
			let key = parts.map(v => v.length).join();
			let bucket = groups[key];
			if (!bucket) groups[key] = bucket = [];
			bucket.push(cps.map(cp => valid_idx.indexOf(cp))); // reindex
		}
		return groups;
	}
}
// this is used by two separate sub-libraries
const VIRAMA_COMBINING_CLASS = 9;

let [mode, ...argv] = process.argv.slice(2);

switch (mode) {
	case 'all': {
		['context', 'nf', 'bidi', 'adraffy', 'uts51', 'others'].forEach(create_payload);
		break;
	}
	case 'sub': {
		['context', 'nf', 'bidi'].map(create_payload);
		break;
	}
	case 'missing-emoji': {
		// find the emoji that are missing from ENS0
		let idna = read_rules_for_ENS0();
		let emoji_seq = map_values(read_parsed('emoji-sequences'), e => e.flatMap(({src}) => {
			return src.includes('..') ? parse_cp_range(src).map(x => [x]) : [parse_cp_sequence(src)]
		}));
		// include all of the singular basic emoji
		let basic = take_from(emoji_seq.Basic_Emoji, v => v.length == 1).flat();
		// include all of the styled emoji 
		let styled = take_from(emoji_seq.Basic_Emoji, v => v.length == 2 && v[1] == 0xFE0F).flatMap(([x]) => x)
		// assert there is nothing left
		if (emoji_seq.Basic_Emoji.length > 0) {
			throw new Error(`Assumption wrong: there are other basic emoji!`);
		}
		let missing = [basic, styled].flat().filter(cp => idna.is_disallowed(cp)).sort((a, b) => a - b); // sort
		console.log(missing.map(cp => ({dec: cp, hex: hex_cp(cp)})));
		//console.log(JSON.stringify(missing));
		break;
	}
	case 'style-drop': {	
		// find the emoji that are valid in ENS0
		let idna = read_rules_for_ENS0();
		let valid = read_emoji_data().Emoji.filter(cp => idna.valid.has(cp));
		if (argv.length == 0) { // just output to console
			console.log(valid);
			break;
		}
		// write file
		writeFileSync(join(ensure_dir('rules'), 'style-drop.js'), [
			`// generated: ${new Date().toJSON()}`,
			`export default [`,
			...valid.map(cp => `{ty:'style-drop', src: '${hex_cp(cp)}'}, // ${String.fromCodePoint(cp)}`),
			'];'
		].join('\n'));
		break;
	}
	case 'demoji': {
		// find the emoji that are mapped by ENS0
		let idna = read_idna_rules({version: 2003});
		let {Emoji} = read_emoji_data();
		let mapped = idna.mapped.filter(([x]) => Emoji.includes(x));
		let invalid = Emoji.filter(cp => !idna.valid.has(cp) && !idna.mapped.some(([x]) => x == cp));
		if (argv.length == 0) { // just output to console
			console.log({mapped, invalid});
			break;
		}	
		writeFileSync(join(ensure_dir('rules'), 'demoji.js'), [
			`// generated: ${new Date().toJSON()}`,
			`export default [`,
			...mapped.map(([x, ys]) => `{ty: 'demoji', src: '${hex_cp(x)}', dst: '${ys.map(hex_cp).join(' ')}'}, // ${String.fromCodePoint(x)} -> ${String.fromCodePoint(...ys)}`),
			...invalid.map(x => `{ty: 'demoji', src: '${hex_cp(x)}'}, // ${String.fromCodePoint(x)}`),
			'];'
		].join('\n'));
		break;
	}
	default: create_payload(mode);
}


function create_payload(name) {
	switch (name) {
		case 'adraffy': {
			let idna = read_idna_rules({version: 2008});
			let uts51 = new UTS51(read_emoji_data());
			apply_rules(idna, uts51, (await import('./rules/adraffy.js')).default);
			idna.check_uts46_assumptions();
			write_rules_payload('idna-adraffy', {idna, uts51});
			break;
		}
		case 'uts51': {
			let idna = new IDNA();
			idna.ignored.add(0xFE0E); // meh
			let uts51 = new UTS51(read_emoji_data());
			apply_rules(idna, uts51, []);
			write_rules_payload('idna-uts51', {idna, stops: new Set(), uts51, combining_marks: new Set()});
			break;
		}
		case 'others': {
			// this is current ENS 
			write_rules_payload('idna-ENS0', read_rules_for_ENS0());
			// these are the true specs
			write_rules_payload('idna-2003', {idna: read_idna_rules({version: 2003})});
			write_rules_payload('idna-2008', {idna: read_idna_rules({version: 2008})});
			break;
		}
		case 'nf': {
			let enc = new Encoder();
			encode_nf(enc, read_nf_rules());
			write_payload('nf', enc);
			break;
		}
		case 'bidi': {
			let enc = new Encoder();
			encode_bidi(enc, read_bidi_rules());
			write_payload('bidi', enc);
			break;
		}
		case 'context': {
			let enc = new Encoder();
			encode_context(enc, read_context_rules());
			write_payload('context', enc);
			break;
		}
		default: throw new Error(`unknown payload: ${name}`);
	}
}


function read_emoji_data() {
	return Object.assign(
		map_values(read_parsed('emoji-data'), e => e.flatMap(parse_cp_range)),
		// RGI_Emoji_ZWJ_Sequence
		{zwj: read_parsed('emoji-zwj-sequences').map(({src}) => parse_cp_sequence(src))},
		//
		// these following exist in emoji-data
		// but can only be identified by parsing the comments
		// regional and tag_spec
		read_parsed('emoji-missing'),
		// keycaps
		{keycaps: read_parsed('emoji-sequences').Emoji_Keycap_Sequence.map(({src}) => parse_cp_sequence(src)[0])}
	);
}

function read_combining_marks() {
	return new Set(Object.entries(read_parsed('DerivedGeneralCategory'))
		.filter(([k]) => k.startsWith('M'))
		.flatMap(([_, v]) => v.flatMap(parse_cp_range)));
}

function read_rules_for_ENS0() {	
	return {
		idna: read_idna_rules({version: 2003, valid_deviations: true}),
		combining_marks: new Set()
	};
}
function read_idna_rules({use_STD3 = true, version = 2008, valid_deviations}) {
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
		throw new Error(`Assumption wrong: Unknown IDNA Keys`);
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
	let idna = new IDNA();
	idna.valid = new Set(valid.flatMap(parse_cp_range));
	idna.ignored = new Set(ignored.flatMap(parse_cp_range));
	// x:[char] => ys:[char, char, ...]
	idna.mapped = mapped.flatMap(([src, dst]) => {
		let cps = parse_cp_sequence(dst);
		// we need to re-apply the rules to the mapped output
		return cps.some(cp => idna.ignored.has(cp) || !idna.valid.has(cp)) ? [] : parse_cp_range(src).map(x => [x, cps]);
	});
	return idna;
}
function encode_idna(enc, {valid, ignored, mapped}, stops) {	
	enc.write_member(stops);
	enc.write_member(valid);
	// ignored is the same thing as map to []
	// but it doesn't compress as well
	enc.write_member(ignored);
	enc.write_mapped([
		[1, 1, 1], // alphabets: ABC
		[1, 2, 2], // paired-alphabets: AaBbCc
		[1, 1, 0], // \ 
		[2, 1, 0], //  adjacent that map to a constant
		[3, 1, 0]  // /   eg. AAAA..BBBB => CCCC
	], mapped);
}

function read_bidi_rules() {
	return map_values(read_parsed('DerivedBidiClass'), v => new Set(v.flatMap(parse_cp_range)));;
}
function encode_bidi(enc, {R, L, AL, AN, EN, ES, CS, ET, ON, BN, NSM}) {
	let R_AL_parts = [R, AL];
	let R_AL = set_union(...R_AL_parts);
	if (!is_better_member_compression([R_AL], R_AL_parts)) {
		throw new Error(`Assumption wrong: R_AL`);
	}
	let ECTOB_parts = [ES, CS, ET, ON, BN];
	let ECTOB = set_union(...ECTOB_parts);
	if (!is_better_member_compression([ECTOB], ECTOB_parts)) {
		throw new Error(`Assumption wrong: ECTOB`);
	}
	enc.write_member(R_AL);
	enc.write_member(L);
	enc.write_member(AN);
	enc.write_member(EN);
	enc.write_member(ECTOB);
	enc.write_member(NSM);
}

function read_nf_rules() {
	let combining_class = read_parsed('DerivedCombiningClass');
	delete combining_class['0']; // we dont need class 0
	combining_class = Object.entries(combining_class)
		.map(([k, v]) => [parseInt(k), new Set(v.flatMap(parse_cp_range))])
		.sort((a, b) => a[0] - b[0]);
	let virama_index = combining_class.findIndex(([cls]) => cls == VIRAMA_COMBINING_CLASS);
	if (virama_index < 0) {
		throw new Error(`Assumption wrong: no virama`);
	}
	combining_class = combining_class.map(([_, v]) => v); // drop the class, we just need order

	// this does not contain hangul
	let decomp = read_parsed('Decomposition_Mapping')
		.map(([x, ys]) => [parse_cp(x), parse_cp_sequence(ys)])
		.sort((a, b) => a[0] - b[0]);

	let comp_exclusions = new Set(read_parsed('CompositionExclusions').flatMap(parse_cp_range));
	
	return {combining_class, virama_index, comp_exclusions, decomp};
}
function encode_nf(enc, {combining_class, comp_exclusions, decomp}) {
	enc.positive(combining_class.length);
	for (let c of combining_class) enc.write_member(c);
	enc.write_mapped([	
		[1, 1, 1],
		[1, 1, 0]
	], decomp);
	enc.write_member(comp_exclusions);
}

function read_context_rules() {
	let {T, L, R, D} = map_values(read_parsed('DerivedJoiningType'), v => new Set(v.flatMap(parse_cp_range)));
	let {Greek, Hebrew, Hiragana, Katakana, Han} = map_values(read_parsed('Scripts'), v => new Set(v.flatMap(parse_cp_range)));
	let Virama = new Set(read_parsed('DerivedCombiningClass')[VIRAMA_COMBINING_CLASS].flatMap(parse_cp_range));
	return {T, L, R, D, Greek, Hebrew, Hiragana, Katakana, Han, Virama};
}
function encode_context(enc, {T, L, R, D, Greek, Hebrew, Hiragana, Katakana, Han, Virama}, virama_index) {

	let LD = set_union(L, D);
	let RD = set_union(R, D);
	if (!is_better_member_compression([LD, RD], [L, R, D])) {
		throw new Error('Assumption wrong: LRD');
	}
	
	let HKH_parts = [Hiragana, Katakana, Han];
	let HKH = set_union(...HKH_parts);
	if (!is_better_member_compression([HKH], HKH_parts)) {
		throw new Error(`Assumption wrong: HKH`);
	}

	/*
	if (virama_index) {
		enc.unsigned(virama_index);
	} else {
		enc.write_member(Virama);	
	}
	*/
	enc.write_member(Virama);
	enc.write_member(T);
	enc.write_member(LD);
	enc.write_member(RD);
	enc.write_member(Greek);
	enc.write_member(Hebrew);
	enc.write_member(HKH);
}


function extract_stops({valid, mapped}) {
	const STOP = 0x2E;
	let stops = new Set([STOP]);
	if (!valid.delete(STOP)) {
		throw new Error(`Assumption wrong: Stop is not valid`);
	}
	for (let [x, ys] of take_from(mapped, ([_, ys]) => ys.includes(STOP))) {
		if (ys.length != 1) {
			throw new Error(`Assumption wrong: ${x} is mapped to a Stop with other characters`);
		}
		stops.add(x);
	}
	return stops;
}

function write_payload(name, enc) {
	let buf = Buffer.from(enc.compress_arithmetic());
	let dir = ensure_dir('output');
	writeFileSync(join(dir, `${name}.js`), `export default '${base64(buf)}'`);
	writeFileSync(join(dir, `${name}.bin`), buf);
	writeFileSync(join(dir, `${name}.json`), JSON.stringify(enc.values));
	console.log(`Wrote payload ${name}: ${buf.length} bytes`);
}

function write_rules_payload(name, {idna, stops, uts51, combining_marks}) {
	if (!stops) {
		// find everything that maps to ".'
		stops = extract_stops(idna);
	}
	let allowed = new Set([...idna.valid, ...idna.mapped.map(([x]) => x)]);
	if (!combining_marks) {
		// use default combining marks if not specified
		combining_marks = read_combining_marks();
	}
	let enc = new Encoder();
	encode_idna(enc, idna, stops);
	enc.write_member(set_intersect(combining_marks, allowed));
	if (uts51) {
		enc.unsigned(1);
		enc.write_member(uts51.REGIONAL);
		enc.write_member(uts51.KEYCAP_DROP);
		enc.write_member(uts51.KEYCAP_REQ);
		enc.write_member(uts51.STYLE_DROP);
		enc.write_member(uts51.STYLE_REQ);
		enc.write_member(uts51.STYLE_OPT);
		enc.write_member(uts51.MODIFIER);
		enc.write_member(uts51.MOD_BASE);
		enc.write_member(uts51.TAG_SPEC);

		let zwj = Object.entries(uts51.group_zwj());
		for (let [key, m] of zwj) {
			// '1,2,3' => [1,2,3] => [[_],[_,_],[_,_,_]]
			let lens = key.split(',').map(x => parseInt(x));
			for (let x of lens) enc.unsigned(x);
			enc.unsigned(0);
			enc.positive(m.length);
			enc.write_transposed(m.sort(compare_arrays));
		}
		enc.unsigned(0);

		// experimental
		enc.write_member(uts51.NON_SOLO); 
	}
	write_payload(name, enc);
}

/*
function write_library_payload(name, {emoji, idna, bidi, nf, context, combining_marks}) {
	let allowed = new Set([...idna.valid, ...idna.mapped.map(([x]) => x)]);
	// filter
	combining_marks = set_intersect(combining_marks, allowed);
	context = map_values(context, v => set_intersect(v, allowed));
	if (nf) {
		nf.combining_class = nf.combining_class.map(v => set_intersect(v, allowed));
		nf.comp_exclusions = set_intersect(nf.comp_exclusions, allowed);
		nf.decomp = nf.decomp.filter(([x]) => allowed.has(x));
	}
	if (bidi) {
		bidi = map_values(bidi, v => set_intersect(v, allowed));
	}
	let enc = new Encoder();
	enc.write_member(combining_marks);
	encode_idna(enc, idna);
	if (emoji) encode_emoji(enc, emoji);
	if (nf) encode_nf(enc, nf);
	encode_context(enc, context);
	if (bidi) encode_bidi(enc, bidi);
	write_payload(name, enc);
}
*/

function apply_rules(idna, uts51, rules) {
	for (let rule of rules) {
		try {
			let {ty, src, dst} = rule;
			switch (ty) {			
				case 'keycap-drop': {
					// proper keycaps are $CAP FE0F 20E3
					// drop match this pattern, but strip the FE0F
					// this is supported as a 1-way downgrade
					for (let cp of parse_cp_multi_ranges(src)) {
						if (!uts51.KEYCAP_REQ.has(cp)) {
							throw new Error(`expected keycap: ${cp}`);
						}
						uts51.KEYCAP_DROP.add(cp);
					}
					continue;
				}
				case 'style-drop': 
				case 'style-opt': 
				case 'style-req': {
					// proper emoji are opt: eg. $EMOJI or $EMOJI FE0F
					// drop matches either pattern, but drops FE0F
					// required only matches FE0F, and keeps the FE0F
					// opt matches either pattern and keeps the FE0F
					for (let cp of parse_cp_multi_ranges(src)) {
						uts51.set_style(cp, ty);
					}
					continue;
				}
				/*
				case 'map-emoji': {
					src = parse_cp_range(rule.src);
					dst = parse_cp_range(rule.dst);
					if (src.length != dst.length) throw new Error(`length`);
					for (let i = 0; i < src.length; i++) {
						if (!remove_emoji_rule(src)) throw new Error(`expected emoji`);
						emoji_MAP[src] = dst;
					}
					continue;
				}
				*/
				case 'demoji': {
					// remove an emoji
					// go thru text processing instead
					let cp = parse_cp(src);
					if (!uts51.remove_style(cp)) throw new Error(`demoji not styled`);
					uts51.NON_SOLO.add(cp);
					// allow for an inline mapping
					if (typeof dst === 'string') {
						idna.remove_rule(cp);
						idna.mapped.push([cp, parse_cp_sequence(dst)]);
					}
					break;
				}
				case 'ignore': {
					for (let cp of parse_cp_multi_ranges(src)) {
						idna.remove_rule(cp);
						idna.ignored.add(cp);
					}
					continue;
				}
				case 'valid': {
					for (let cp of parse_cp_multi_ranges(src)) {
						idna.remove_rule(cp);
						idna.valid.add(cp);
					}
					continue;
				}
				case 'disallow': {
					for (let cp of parse_cp_multi_ranges(src)) {
						idna.remove_rule(cp);
					}
					continue;
				}
				case 'map': {
					if (dst.includes(' ')) { // MAP x TO ys...
						src = parse_cp(src);
						dst = parse_cp_sequence(dst);
						idna.remove_rule(src);
						idna.mapped.push([src, dst]);
					} else { // map [x,x+1,...] to [y,y+1,...]
						src = parse_cp_range(rule.src);
						dst = parse_cp_range(rule.dst);
						//if (dst.length == 1) dst = Array(src.length).fill(dst[0]); // map to single value
						if (src.length != dst.length) throw new Error(`length`);
						for (let i = 0; i < src.length; i++) {
							let cp = src[i];
							idna.remove_rule(cp);
							idna.mapped.push([cp, [dst[i]]]);
						}
					}
					continue;
				}
				default: throw new Error(`unknown type: ${rule.ty}`);
			}
		} catch (err) {
			console.error(rule);
			throw new Error(`bad rule: ${err.message}`)
		}
	}
	// these emoji must be used with a FE0F
	// so they cannot be handled by text processing
	for (let cp of uts51.STYLE_REQ) {
		idna.remove_rule(cp); // disallows
	}
	idna.check_invariants();
}