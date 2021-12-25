import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {Encoder, is_better_member_compression} from './encoder.js';
import {parse_cp, parse_cp_range, parse_cp_sequence, 
	take_from, group_by, map_values, set_union, set_intersect, split_ascending} from './utils.js';

let base_dir = new URL('.', import.meta.url).pathname;

let output_dir = join(base_dir, 'output');
mkdirSync(output_dir, {recursive: true});

function read_parsed(name) {
	return JSON.parse(readFileSync(join(base_dir, 'unicode-json', `${name}.json`)));
}

const VIRAMA_COMBINING_CLASS = 9;

let [mode, ...argv] = process.argv.slice(2);
switch (mode) {
	case 'lib': {
		let {idna, emoji} = update_idna_rules(read_idna_rules({version: 2008}), (await import('./ens-rules.js')).default);
		// this is adraffy
		write_idna_payload('idna-adraffy', idna, emoji);
		// this is current ENS 
		write_idna_payload('idna-ENS0', read_idna_rules({version: 2003, valid_deviations: true}));		
		// these are the true specs
		write_idna_payload('idna-2003', read_idna_rules({version: 2003}));
		write_idna_payload('idna-2008', read_idna_rules({version: 2008}));		
		break;
	}
	case 'static': {
		{
			let enc = new Encoder();
			encode_nf(enc, read_nf_rules());
			write_payload('nf', enc);
		}
		{
			let enc = new Encoder();
			encode_bidi(enc, read_bidi_rules());
			write_payload('bidi', enc);
		}
		{
			let enc = new Encoder();
			encode_context(enc, read_context_rules());
			write_payload('context', enc);
		}
		break;
	}
	default: throw new Error(`unknown mode: ${mode}`);
}

function read_combining_marks() {
	return new Set(Object.entries(read_parsed('DerivedGeneralCategory'))
		.filter(([k]) => k.startsWith('M'))
		.flatMap(([_, v]) => v.flatMap(parse_cp_range)));
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
	valid = new Set(valid.flatMap(parse_cp_range));
	ignored = new Set(ignored.flatMap(parse_cp_range));
	// x:[char] => ys:[char, char, ...]
	mapped = mapped.flatMap(([src, dst]) => {
		let cps = parse_cp_sequence(dst);
		// we need to re-apply the rules to the mapped output
		return cps.some(cp => ignored.has(cp) || !valid.has(cp)) ? [] : parse_cp_range(src).map(x => [x, cps]);
	});
	return {valid, ignored, mapped};
}
function encode_idna(enc, {valid, ignored, mapped}) {
	const STOP = 0x2E;
	let stops = new Set([STOP]);
	if (!valid.delete(STOP)) {
		throw new Error(`Assumption wrong: Stop is not valid`);
	}
	for (let [x, ys] of take_from(mapped, ([_, ys]) => ys.includes(STOP))) {
		if (ys.length != 1) {
			throw new Error(`Assumption wrong: ${x} is mapped to a Stop with other characters`);
		}
	}
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

function encode_emoji(enc, {REGIONAL, KEYCAP_OG, KEYCAP_FIXED, OPT, REQ, MODIFIER, MOD_BASE, TAG_SPEC}) {
	enc.write_member(REGIONAL);
	enc.write_member(KEYCAP_OG);
	enc.write_member(KEYCAP_FIXED);
	enc.write_member(OPT);
	enc.write_member(REQ);
	enc.write_member(MODIFIER);
	enc.write_member(MOD_BASE);
	enc.write_member(TAG_SPEC);
}

function write_payload(name, enc) {
	let buf = Buffer.from(enc.compress_arithmetic());
	writeFileSync(join(output_dir, `${name}.js`), `export default '${btoa(String.fromCharCode(...buf))}'`);
	writeFileSync(join(output_dir, `${name}.bin`), buf);
	writeFileSync(join(output_dir, `${name}.json`), JSON.stringify(enc.values));
	console.log(`Wrote payload ${name}: ${buf.length} bytes`);
}

function write_idna_payload(name, idna, emoji) {
	let allowed = new Set([...idna.valid, ...idna.mapped.map(([x]) => x)]);
	let combining_marks = set_intersect(read_combining_marks(), allowed);
	let enc = new Encoder();
	encode_idna(enc, idna);
	enc.write_member(combining_marks);
	if (emoji) {
		enc.unsigned(1);
		encode_emoji(enc, emoji);
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

function update_idna_rules(idna, rules) {

	let {ignored, valid, mapped} = idna;
	let emoji_data = map_values(read_parsed('emoji-data'), e => e.flatMap(parse_cp_range));
	let emoji_seq = map_values(read_parsed('emoji-sequences'), e => e.flatMap(({src}) => {
		return src.includes('..') ? parse_cp_range(src).map(x => [x]) : [parse_cp_sequence(src)]
	}));

	/*
	let emoji_zwj = read_parsed('emoji-zwj-sequences').map(x => parse_cp_sequence(x.hex));
	*/

	let emoji_OG = new Set(emoji_data.Emoji);
	//let emoji_MAP = {};

	let emoji = {
		OG: emoji_OG,
		OPT: new Set(),
		REQ: new Set(),
		REGIONAL: new Set(),
		KEYCAP_OG: new Set(),
		KEYCAP_FIXED: new Set(),
		TAG_SPEC: new Set(),
		MOD_BASE: new Set(),
		MODIFIER: new Set()
	};

	function remove_emoji_rule(cp) {
		if (Object.values(emoji).some(set => set.delete(cp))) {
			return true; // removed from set
			/*
		} else if (cp in emoji_MAP) {
			delete emoji_MAP[cp];
			return true;
			*/
		}
	}

	// check that Emoji_Presentation is a subset of emoji
	if (emoji_data.Emoji_Presentation.some(cp => !emoji_OG.has(cp))) {
		throw new Error(`Assumption wrong: Emoji_Presentation not emoji`);
	}
	// check that Emoji_Modifier_Base is a subset of emoji
	if (emoji_data.Emoji_Modifier_Base.some(cp => !emoji_OG.has(cp))) {
		throw new Error(`Assumption wrong: Emoji_Modifier_Base not emoji`);
	}
	// check that Emoji_Modifier is a subset of emoji
	if (emoji_data.Emoji_Modifier.some(cp => !emoji_OG.has(cp))) {
		throw new Error(`Assumption wrong: Emoji_Modifier are emoji`);
	}

	// find all the non-emoji emoji (seriously?)
	let picto = new Set(take_from(emoji_data.Extended_Pictographic, cp => !emoji_OG.has(cp)));

	// include all of the singular basic emoji
	for (let [cp] of take_from(emoji_seq.Basic_Emoji, v => v.length == 1)) {
		remove_emoji_rule(cp);
		emoji.OPT.add(cp);
	}
	// include all of the styled emoji 
	for (let [cp] of take_from(emoji_seq.Basic_Emoji, v => v.length == 2 && v[1] == 0xFE0F)) {
		remove_emoji_rule(cp);
		emoji.OPT.add(cp);
	}
	if (emoji_seq.Basic_Emoji.length > 0) {
		throw new Error(`Assumption wrong: there are other basic emoji!`);
	}

	// assign modifier_base
	for (let cp of emoji_data.Emoji_Modifier_Base) {
		remove_emoji_rule(cp);
		emoji.MOD_BASE.add(cp);
	}
	// assign modifier
	for (let cp of emoji_data.Emoji_Modifier) {
		remove_emoji_rule(cp);
		emoji.MODIFIER.add(cp);
	}
	
	// TODO: move any unused emoji to the new emoji set

	function remove_idna_rule(cp) {
		if (ignored.delete(cp)) return true;
		if (valid.delete(cp)) return true;
		let pos = mapped.findIndex(([x]) => cp == x);
		if (pos >= 0) {
			mapped.splice(pos, 1);
			return true;
		}
		return false;
	}

	function for_each_rule_cp(src, fn) {
		src.split(/\s+/).flatMap(parse_cp_range).forEach(fn);
	}
	function move_to_emoji_set(src, set) {
		for_each_rule_cp(src, cp => {
			remove_emoji_rule(cp);
			set.add(cp);
		});
	}

	// custom ENS modifications
	for (let rule of rules) {
		try {
			let {ty, src, dst} = rule;
			switch (ty) {
				case 'tag-spec': {
					move_to_emoji_set(src, emoji.TAG_SPEC);
					continue;
				}
				case 'keycap': {
					move_to_emoji_set(src, emoji.KEYCAP_OG);
					continue;
				}
				case 'styled-keycap': {
					move_to_emoji_set(src, emoji.KEYCAP_FIXED);
					continue;
				}
				case 'regional': {
					move_to_emoji_set(src, emoji.REGIONAL);
					continue;
				}
				case 'emoji': {
					move_to_emoji_set(src, emoji.OPT);
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
				case 'styled-emoji': {
					move_to_emoji_set(src, emoji.REQ);
					continue;
				}
				case 'ignore': {
					for_each_rule_cp(src, cp => {
						remove_idna_rule(cp);
						ignored.add(cp);
					});
					continue;
				}
				case 'valid': {
					for_each_rule_cp(src, cp => {
						remove_idna_rule(cp);
						valid.add(cp);
					});
					continue;
				}
				case 'disallow': {
					for_each_rule_cp(src, cp => {
						remove_idna_rule(cp);
					});
					continue;
				}
				case 'map': {
					if (dst.includes(' ')) { // MAP x TO ys...
						src = parse_cp(src);
						dst = parse_cp_sequence(dst);
						remove_emoji_rule(src);
						remove_idna_rule(src);
						mapped.push([src, dst]);
					} else { // map [x,x+1,...] to [y,y+1,...]
						src = parse_cp_range(rule.src);
						dst = parse_cp_range(rule.dst);
						//if (dst.length == 1) dst = Array(src.length).fill(dst[0]); // map to single value
						if (src.length != dst.length) throw new Error(`length`);
						for (let i = 0; i < src.length; i++) {
							let cp = src[i];
							remove_emoji_rule(cp);
							remove_idna_rule(cp);
							mapped.push([cp, [dst[i]]]);
						}
					}
					continue;
				}
				default: throw new Error(`unknown type: ${rule.type}`);
			}
		} catch (err) {
			console.error(rule);
			throw new Error(`bad rule: ${err.message}`)
		}
	}

	// these emoji cant be used solo
	for (let cp of emoji.REQ) {
		remove_idna_rule(cp);
	}

	// allowed emoji that are pictos
	// should become valid characters
	for (let cp of emoji.OPT) {
		if (picto.has(cp)) {
			remove_idna_rule(cp);	
			emoji.OPT.delete(cp);
			valid.add(cp);
		}
	}

	// everything in the mapped output should be valid
	for (let [x, ys] of mapped) {
		if (ys.some(cp => ignored.has(cp) || !valid.has(cp))) {
			console.log([x, ys]);
			throw new Error(`Invalid rules: mapped is ignored or disallowed`);
		}
	}

	if (!ignored.has(0xFE0F)) throw new Error('Assumption wrong: FE0F not ignored');
	if (!valid.has(0x200C)) throw new Error('Assumption wrong: ZWNJ not valid');
	if (!valid.has(0x200D)) throw new Error('Assumption wrong: ZWJ not valid');

	return {emoji, idna: {ignored, valid, mapped}};
}