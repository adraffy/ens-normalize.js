import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {Encoder, is_better_member_compression, base64} from './encoder.js';
import {
	hex_cp, parse_cp, parse_cp_range, parse_cp_sequence, parse_cp_multi_ranges,
	map_values, take_from, set_union, set_intersect, set_complement, split_on, 
	compare_arrays, explode_cp, binary_search, group_by, split_between
} from './utils.js';
import {read_parsed} from './nodejs-utils.js';
import {
	read_emoji_data, read_combining_marks, read_script_sets, 
	read_idna_rules, read_bidi_rules, read_context_joining_types
} from './unicode-logic.js';
import {IDNA, UTS51, apply_rules, rules_for_adraffy, rules_for_ens0} from './rules.js';

let base_dir = new URL('./', import.meta.url).pathname;

function ensure_dir(name) {
	let dir = join(base_dir, name);
	mkdirSync(dir, {recursive: true});
	return dir;
}

let lib_nf;
async function import_nf() {
	if (!lib_nf) {
		await create_payload('nf');
		lib_nf = await import('./nf.js');
	}
	return lib_nf;
}

// this is used by two separate sub-libraries
const VIRAMA_COMBINING_CLASS = 9;

let [mode, ...argv] = process.argv.slice(2);
switch (mode) {
	// ============================================================
	// build various payloads
	// ============================================================
	case undefined: {
		[
			'context', 'nf', 'bidi', 'dns',
			'v1', 'v2', 'adraffy', 
			'adraffy-exp', 'adraffy-compat', 
			'UTS51', 'UTS46', 'ENS0', '2003', '2008'
		].forEach(create_payload);
		break;
	}
	// ============================================================
	// simple queries
	// ============================================================
	case 'emoji-data': {
		let emoji = read_emoji_data();
		if (argv.length == 0) { // just output to console
			console.log(emoji);
			break;
		}
		writeFileSync(join(ensure_dir('output'), 'emoji-data.json'), JSON.stringify(emoji));
		break
	}
	case 'missing-emoji': {
		// find the emoji that are missing from ENS0
		let {idna} = rules_for_ens0();
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
	case 'diff': {
		// find the differences in allowed between the two
		let {idna: idna_ENS0} = rules_for_ens0();
		let idna_2008 = IDNA.from_data({version: 2008});
		let only_ENS0 = set_complement(idna_ENS0.VALID, idna_2008.VALID); // valid + mapped
		let only_2008 = set_complement(idna_2008.VALID, idna_ENS0.VALID);
		if (only_2008.size !== 0) {
			console.log([...only_2008]);
			throw new Error('Assumption wrong: IDNA 2008 enabled something');
		}
		let without_emoji = set_complement(only_ENS0, read_emoji_data().Emoji); // remove emoji
		if (argv.length == 0) { // just output to console
			console.log([...without_emoji]);
			break;
		}
		writeFileSync(join(ensure_dir('output'), 'idna-diff-ENS0vs2008.json'), JSON.stringify([...without_emoji]));
		break;
	}
	case 'cm': {
		// dump the combining marks that are valid in IDNA 2008
		let v = [...set_intersect(
			read_combining_marks(), 
			IDNA.from_data({version: 2008}).VALID
		)].sort((a, b) => a - b);
		let map = Object.fromEntries(v.map(cp => [hex_cp(cp), String.fromCodePoint(cp)]));
		if (argv.length == 0) {
			console.log(map);
			break;
		}
		writeFileSync(join(ensure_dir('output'), 'cm.json'), JSON.stringify(map));
		break;
	}
	case 'context-o': {
		let scripts = read_script_sets(3);
		for (let script of ['Grek', 'Hebr']) {
			let set = new Set(scripts[key]);
			let isolated = true;
			for (let [k, v] of Object.entries(scripts)) {
				if (k === key) continue;
				if (v.some(cp => set.has(cp))) {
					isolated = false;
					break;
				}
			}
			console.log(key, isolated);
		}
		break;
	}
	case 'nfc-idna': {
		let {nfc} = await import_nf();
		let {mapped} = read_idna_rules({version: 2008});
		let found = mapped.filter(([x, ys]) => compare_arrays(nfc([x]), ys) == 0);
		console.log(found.length);
		break;
	}
	case 'an': {
		let scripts = read_script_sets({level: 3});
		console.log(parse_cp_multi_ranges('660..669 6F0..6F9').map(cp => {
			return [cp.toString(16), Object.entries(scripts).filter(([_, set]) => set.has(cp)).map(([name]) => name)];
		}));
		break;
	}
	case 'mapped-cm': {
		let {idna} = await rules_for_adraffy();
		let {nfc} = await import_nf();
		let cm = read_combining_marks();
		let [cm0] = cm.values();
		for (let [x, ys] of idna.MAPPED) {
			if (ys.some(cp => cm.has(cp))) {
				for (let c of cm) {
					let cps = [...ys, c];
					if (compare_arrays(cps, nfc(cps))) {
						console.log(x, ys, c, nfc(cps));
						throw 'wtf';
					}
				}
			}
		}
		break;
	}
	/*
	case 'confusable-groups': {
		let {nfc} = await import_nf();
		// turn confusables into unordered pairs
		let pairs = Object.entries(read_parsed('confusables')).flatMap(([x, ys]) => {
			x = String.fromCodePoint(...parse_cp_sequence(x));
			return ys.map(y => [x, String.fromCodePoint(...parse_cp_sequence(y))]);
		});
		// add in additional pairs
		for (let input of (await import('./rules/extra-confusables.js')).default) {
			try {
				if (!Array.isArray(input)) throw new Error('expected array');
				if (input.length < 2) throw new Error('expected 2+');
				let v = input.map(x => String.fromCodePoint(...parse_cp_sequence(x)));
				for (let i = 1; i < v.length; i++) {
					pairs.push([v[0], v[i]]);
				}
			} catch (err) {
				console.log(`bad confuse`, input);
				throw new err;
			}
		}
		// cluster pairs
		let sets = [];
		let map = {};
		for (let [a, b] of pairs) {
			let aa = nfc(explode_cp(a)).map(hex_cp).join(' ');
			let bb = nfc(explode_cp(b)).map(hex_cp).join(' ');
			if (aa === bb) continue;
			let aaa = map[aa];
			let bbb = map[bb];
			if (aaa && bbb && aaa !== bbb) throw new Error('wtf');
			if (aaa) {
				map[bb] = bbb = aaa;
			} else if (bbb) {
				map[aa] = aaa = bbb;
			} else {
				map[aa] = map[bb] = aaa = bbb = new Set()
				sets.push(aaa);
			}
			aaa.add(aa);
			aaa.add(bb);
		}
		writeFileSync(join(ensure_dir('output'), 'confusable-groups.json'), JSON.stringify(sets.map(set => [...set])));
		break;
	}
	*/
	case 'ss': {
		let {idna} = await rules_for_adraffy();
		function compress(set) {
			return split_between([...set].filter(x => idna.VALID.has(x)).sort((a, b) => a - b), (a, b) => b - a > 1).map(v => v.length == 1 ? v[0] : [v[0], v[v.length-1]]);
		}
		writeFileSync(join(ensure_dir('output'), 'ss-3.json'), JSON.stringify(map_values(read_script_sets({level:3}), compress)));
		writeFileSync(join(ensure_dir('output'), 'ss-4.json'), JSON.stringify(map_values(read_script_sets({level:4}), compress)));
		break;
	}
	// ============================================================
	// dump generated rule files
	// ============================================================
	case 'emoji-zwj': {
		// find the RGI zwj sequences
		let seqs = read_parsed('emoji-zwj-sequences').map(({src}) => parse_cp_sequence(src));
		if (argv.length == 0) { // just output to console
			console.log(seqs);
			break;
		}
		writeFileSync(join(ensure_dir('rules'), 'emoji-zwj.js'), [
			`// generated: ${new Date().toJSON()}`,
			`export default [`,
			...seqs.map(v => `{ty: 'emoji-zwj', src: '${v.map(hex_cp).join(' ')}'}, // ${String.fromCodePoint(...v)}`),
			'];'
		].join('\n'));
		break;
	}
	case 'emoji-seq': {
		// find all the remaining sequences
		// as of 20220104: this is just Tags
		let tags = read_parsed('emoji-sequences').RGI_Emoji_Tag_Sequence.map(({src}) => parse_cp_sequence(src));
		if (argv.length == 0) {
			console.log(tags);
			break;
		}
		writeFileSync(join(ensure_dir('rules'), 'emoji-seq.js'), [
			`// generated: ${new Date().toJSON()}`,
			`export default [`,
			...tags.map(v => `{ty: 'emoji-seq', src: '${v.map(hex_cp).join(' ')}'}, // ${String.fromCodePoint(...v)}`),
			'];'
		].join('\n'));
		break;
	}
	case 'style-drop': {	
		// find the emoji that are valid in ENS0
		let {idna} = rules_for_ens0();
		let {Emoji} = read_emoji_data();
		let valid = Emoji.filter(cp => idna.VALID.has(cp));
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
		let {idna} = rules_for_ens0();
		let {Emoji} = read_emoji_data();
		let mapped = idna.MAPPED.filter(([x]) => Emoji.includes(x));
		let invalid = Emoji.filter(cp => !idna.VALID.has(cp) && !idna.is_mapped(cp));
		if (argv.length == 0) { // just output to console
			console.log({mapped, invalid});
			break;
		}
		// write file
		writeFileSync(join(ensure_dir('rules'), 'demoji.js'), [
			`// generated: ${new Date().toJSON()}`,
			`export default [`,
			...mapped.map(([x, ys]) => `{ty: 'demoji', src: '${hex_cp(x)}', dst: '${ys.map(hex_cp).join(' ')}'}, // ${String.fromCodePoint(x)} -> ${String.fromCodePoint(...ys)}`),
			...invalid.map(x => `{ty: 'demoji', src: '${hex_cp(x)}'}, // ${String.fromCodePoint(x)}`),
			'];'
		].join('\n'));
		break;
	}
	default: await create_payload(mode);
}

async function create_payload(name) {
	switch (name) {
		case 'v1': {
			write_v1_payload(await rules_for_adraffy());
			break;
		}
		case 'v2': {
			write_v2_payload(await rules_for_adraffy());
			break;
		}
		case 'v3': {
			let idna = IDNA.from_data({version: 2003, valid_deviations: true});
			let uts51 = UTS51.from_data();
			apply_rules(idna, uts51, (await import('./rules/adraffy-v3.js')).default);
			write_v3_payload({idna, uts51});
			break;
		}
		case 'adraffy': {			
			write_rules_payload('adraffy', await rules_for_adraffy());
			break;
		}
		case 'adraffy-exp': {
			// adraffy with additional whitelist
			let idna = IDNA.from_data({version: 2008});
			let uts51 = UTS51.from_data();
			apply_rules(idna, uts51, [
				(await import('./rules/adraffy.js')).default,
				(await import('./rules/whitelist.js')).default
			].flat());
			idna.check_assumptions();
			uts51.check_assumptions();
			write_rules_payload('adraffy-exp', {idna, uts51});
			break;
		}
		case 'adraffy-compat': {
			// ENS0 with emoji
			let idna = IDNA.from_data({version: 2003, valid_deviations: true});
			let uts51 = UTS51.from_data();
			apply_rules(idna, uts51, (await import('./rules/adraffy.js')).default);
			idna.check_assumptions();
			uts51.check_assumptions();
			write_rules_payload('adraffy-compat', {idna, uts51});
			break;
		}
		case 'UTS51': {
			let idna = new IDNA();
			idna.IGNORED.add(0xFE0E); // only non-emoji character allowed
			let uts51 = UTS51.from_data();
			uts51.ZWJS = undefined; // disable whitelist
			apply_rules(idna, uts51, []);
			write_rules_payload(name, {idna, stops: new Set(), uts51, combining_marks: new Set()});
			break;
		}		
		case 'UTS46': {
			// 2003 with deviations (for IDNATestV2)
			write_rules_payload(name, {idna: read_idna_rules({version: 2003, valid_deviations: true})});
			break;
		}
		case 'ENS0': {
			// legacy ENS 
			write_rules_payload(name, rules_for_ens0());
			break;
		}
		case '2003': {
			write_rules_payload(name, {idna: read_idna_rules({version: 2003})});
			break;
		}
		case '2008': {
			write_rules_payload(name, {idna: read_idna_rules({version: 2008})});
			break;
		}	
		case 'dns': {
			/*
			let idna = read_idna_rules({version: 2008});
			let enc = new Encoder();
			enc.write_member(idna.VALID);
			write_payload(name, enc);
			*/
			// dump lower ascii from puny
			let puny_ASCII = cp => cp < 128; // N from https://datatracker.ietf.org/doc/html/rfc3492#section-5
			let idna2003 = [...read_idna_rules({version: 2003}).valid].filter(puny_ASCII);
			let idna2008 = [...read_idna_rules({version: 2008}).valid].filter(puny_ASCII);
			if (compare_arrays(idna2003, idna2008)) {
				throw new Error('Assumption wrong: IDNA 2003 and 2008 have different Puny ASCII Sets');
			}
			writeFileSync(join(ensure_dir('output'), 'dns.js'), `export default ${JSON.stringify(String.fromCodePoint(...idna2003))}`);
			break;
		}
		case 'nf': {
			let enc = new Encoder();
			encode_nf(enc, read_nf_rules());
			write_payload(name, enc);
			break;
		}
		case 'bidi': {
			let enc = new Encoder();
			encode_bidi(enc, read_bidi_rules());
			write_payload(name, enc);
			break;
		}
		case 'context': {
			let enc = new Encoder();
			encode_context(enc, read_context_rules());
			write_payload(name, enc);
			break;
		}
		/*
		case 'single-script': {
			let enc = new Encoder();
			encode_single_script(enc, read_single_script_rules());
			write_payload('single-script', enc);
			break;
		}
		*/
		default: throw new Error(`unknown payload: ${name}`);
	}
}


function encode_idna(enc, idna) {	
	enc.write_member(idna.VALID);
	// ignored is the same thing as map to []
	// but it doesn't compress as well
	// likely because it breaks ranges
	enc.write_member(idna.IGNORED);
	enc.write_mapped([
		[1, 1, 1], // alphabets: ABC
		[1, 2, 2], // paired-alphabets: AaBbCc
		[1, 1, 0], // \ 
		[2, 1, 0], //  adjacent that map to a constant
		[3, 1, 0]  // /   eg. AAAA..BBBB => CCCC
	], idna.MAPPED);
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
	
	let combining_rank = combining_class.map(([_, v]) => v); // drop the class, we just need order

	// this does not contain hangul
	let decomp = read_parsed('Decomposition_Mapping')
		.map(([x, ys]) => [parse_cp(x), parse_cp_sequence(ys)])
		.sort((a, b) => a[0] - b[0]);

	let comp_exclusions = new Set(read_parsed('CompositionExclusions').flatMap(parse_cp_range));
	
	return {combining_rank, comp_exclusions, decomp, virama_index};
}
function encode_nf(enc, {combining_rank, comp_exclusions, decomp}) {
	enc.unsigned(combining_rank.length);
	for (let c of combining_rank) enc.write_member(c);
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
function encode_context(enc, {T, L, R, D, Greek, Hebrew, Hiragana, Katakana, Han, Virama}) {
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
	enc.write_member(Virama);	
	enc.write_member(T);
	enc.write_member(LD);
	enc.write_member(RD);
	enc.write_member(Greek);
	enc.write_member(Hebrew);
	enc.write_member(HKH);
}

function write_payload(name, enc, hr) {
	let dir = ensure_dir('output');
	// compressed
	let buf = Buffer.from(enc.compress_arithmetic());
	writeFileSync(join(dir, `${name}.js`), `
		import {read_compressed_payload} from '../decoder.js';
		export default read_compressed_payload('${base64(buf)}');
	`);
	// no compression overhead (much larger files)
	writeFileSync(join(dir, `${name}-xcompress.js`), `
		import {read_payload} from '../decoder.js';
		export default read_payload(${JSON.stringify(enc.values)});
	`);
	// raw arithmetic bits
	writeFileSync(join(dir, `${name}.bin`), buf);
	// raw symbols
	writeFileSync(join(dir, `${name}.json`), JSON.stringify(enc.values));
	// human readable
	if (hr) writeFileSync(join(dir, `${name}-hr.json`), JSON.stringify(hr, (_, x) => {
		if (x instanceof Set) {
			return [...x];
		} else {
			return x;
		}
	}));
	// print compressed size
	console.log(`Wrote payload ${name}: ${buf.length} bytes`);
}

function encode_seq(enc, mCPS) {
	for (let m of Object.values(group_by(mCPS, v => v.length))) {
		let w = m[0].length;
		if (w == 0) throw new Error(`expected non-empty`);
		enc.unsigned(w);
		enc.positive(m.length);
		enc.write_transposed(m.sort(compare_arrays));
	}
	enc.unsigned(0);
}

function group_zwj(seqs, sorted) {
	let groups = {};
	for (let seq of seqs) {
		let cps0 = explode_cp(seq);
		let parts = split_on(cps0.filter(cp => cp != 0xFE0F), 0x200D);
		if (parts.length == 1) {
			console.error(cps0);
			throw new Error(`ZWJ sequence without ZWJ`);
		} 
		let cps = parts.flat(); // joiners removed
		let idx = cps.map(cp => binary_search(sorted, cp));
		if (!idx.every(x => x >= 0)) {
			console.error(cps0);
			throw new Error(`ZWJ sequence contains invalid emoji`);
		}
		let key = parts.map(v => v.length).join();
		let bucket = groups[key];
		if (!bucket) groups[key] = bucket = [];
		bucket.push(idx);
	}
	return groups;
}
function encode_zwj(enc, uts51, sorted) {
	if (!sorted) {
		sorted = [...new Set([...this.STYLE_DROP, ...this.STYLE_OPT, ...this.STYLE_REQ])].sort((a, b) => a - b);
	}
	for (let [key, m] of Object.entries(group_zwj(uts51.ZWJS, sorted))) {
		// '1,2,3' => [1,2,3] => [[_],[_,_],[_,_,_]]
		let lens = key.split(',').map(x => parseInt(x));
		for (let x of lens) enc.unsigned(x);
		enc.unsigned(0);
		enc.positive(m.length);
		enc.write_transposed(m.sort(compare_arrays));
	}
	enc.unsigned(0);
}
 
function write_rules_payload(name, {idna, stops, uts51, combining_marks}) {
	if (!stops) {
		// find everything that maps to "."
		stops = idna.extract_stops();
	}
	if (!combining_marks) {
		// use default combining marks if not specified
		combining_marks = read_combining_marks();
	}
	combining_marks = set_intersect(combining_marks, idna.VALID);

	let enc = new Encoder();
	enc.write_member(stops);
	encode_idna(enc, idna);
	enc.write_member(combining_marks);

	let hr = {
		name,
		idna: {...idna},
		stops,
		combining_marks
	};

	if (uts51) {
		hr.uts51 = {...uts51};

		enc.unsigned(1); // emoji enabled
		enc.write_member(uts51.REGIONAL);
		enc.write_member(uts51.KEYCAP_DROP);
		enc.write_member(uts51.KEYCAP_REQ);
		enc.write_member(uts51.STYLE_DROP);
		enc.write_member(uts51.STYLE_REQ);
		enc.write_member(uts51.STYLE_OPT);
		enc.write_member(uts51.MODIFIER);
		enc.write_member(uts51.MOD_BASE);
		enc.write_member(uts51.TAG_SPEC);

		// whitelisted emoji sequences
		encode_seq(enc, [...uts51.SEQS].map(explode_cp));

		// whitelisted emoji zwj sequences
		// when disabled, uses algorithmic rules
		if (uts51.ZWJS) {
			enc.unsigned(1); // whitelist enabled
			encode_zwj(enc, uts51);
		}

		// experimental
		//enc.write_member(uts51.NON_SOLO); 
	}
	write_payload(`rules-${name}`, enc, hr);
}

function reindex(v, sorted) {
	return Array.from(v, cp => binary_search(sorted, cp));
}

function encode_scripts(enc, scripts) {
	let sets = scripts.map(v => new Set(v));
	let merged = [];
	let merges = [];
	while (true) {	
		let subsets = sets.map((set0, i) => {
			let v = [];
			if (!merged[i]) {
				let small = [...set0];
				for (let j = 0; j < sets.length; j++) {
					if (i == j) continue;
					let big = sets[j];
					if (big.size < small.length) continue;
					if (!small.every(x => big.has(x))) continue;
					v.push(j);
				}
			}
			return v;
		});
		let free = subsets.reduce((max, v, i) => {
			if (v.length > 0 && !subsets.some(u => u.includes(i))) {
				if (max == -1 || sets[max].size < sets[i].size) {
				//if (max == -1 || subsets[max].length < subsets[i].length) {
					max = i;
				}
			}
			return max;
		}, -1);
		if (free < 0) break;

		/*
		let free = subsets.flatMap((v, i) => v.length == 0 || subsets.some(u => u.includes(i)) ? [] : [i]);		
		if (free.length == 0) break;
		let max = free.reduce((a, i) => Math.max(a, sets[i].size), 0);
		*/
		merged[free] = true;
		merges.push([free, subsets[free]]);

		/*
		let small = sets[free];
		for (let i of subsets[free]) {
			let big = sets[i];
			for (let x of small) {
				if (!big.has(x)) throw new Error('wtf');
			}
		}
		*/
	}
	for (let [x, ys] of merges) {
		for (let y of ys) {
			for (let cp of sets[x]) {
				sets[y].delete(cp);
			}
		}
	}
	enc.unsigned(sets.length);
	for (let v of sets) {
		enc.write_member(v);
	}
	for (let [x, ys] of merges) {
		enc.unsigned(x + 1);
		enc.write_member(ys);
	}
	enc.unsigned(0);
}

/*
async function apply_confusables(idna) {

	let {nfc} = await import_nf();

	let forced_valid = set_complement(idna.VALID, idna.VALID0);

	for (let [confuse, matches] of Object.entries(read_parsed('confusables'))) { 
		matches = matches.map(parse_cp_sequence);
		confuse = String.fromCodePoint(...parse_cp_sequence(confuse));
		let unique_forms = new Set();
		for (let cps of matches) {
			cps = nfc(cps); // convert to nfc
			if (Math.max(...cps) < 0x80) continue; // ignore ascii
			if (!cps.every(cp => idna.VALID.has(cp))) continue; // not possible 
			let form = String.fromCodePoint(...cps);
			if (unique_forms.has(form)) continue; // already handled		
			unique_forms.add(form);
			if (cps.length == 1) {
				idna.remove_rule(cps[0]);
			} else {
				console.log(form);
				idna.INVALID_SEQS.add(form);
			}
		}
	}

	for (let cp of forced_valid) {
		idna.remove_rule(cp);
		idna.VALID.add(cp);
	}

	idna.remove_invalid_mapped();
	idna.check_invariants();
	idna.check_assumptions();
}
*/


function write_v3_payload({idna, uts51}) {

	if (uts51.KEYCAP_DROP.size > 0) throw new Error('wtf');
	if (uts51.STYLE_OPT.size > 0) throw new Error('wtf');
	if (uts51.STYLE_REQ.size > 0) throw new Error('wtf');

	let enc = new Encoder();
	encode_idna(enc, idna);

	const SORTED_EMOJI = [...uts51.STYLE_DROP].sort((a, b) => a - b);

	enc.write_member(uts51.KEYCAP_REQ);
	enc.write_member(uts51.STYLE_DROP);
	enc.write_member(reindex(uts51.MOD_BASE, SORTED_EMOJI));
	enc.write_member(reindex(uts51.MODIFIER, SORTED_EMOJI));

	encode_seq(enc, Array.from(uts51.SEQS, explode_cp));
	encode_zwj(enc, uts51, SORTED_EMOJI);

	let nf = read_nf_rules();
	encode_nf(enc, nf);

	write_payload(`v3`, enc, {
		valid: idna.VALID,
		mapped: idna.MAPPED,
		ignored: idna.IGNORED,
		keycaps: uts51.KEYCAP_REQ,
		style: uts51.STYLE_DROP,
		modifier: uts51.MODIFIER,
		modifier_base: uts51.MOD_BASE,
		whitelist_seq: [...uts51.SEQS].map(explode_cp),
		whitelist_zwj: [...uts51.ZWJS].map(explode_cp),
		normalized_forms: nf
	});
}

function write_v2_payload({idna, uts51}) {

	if (uts51.STYLE_OPT.size > 0) throw new Error('optional style not supported');

	if (idna.extract_stops().size != 1) throw new Error('expected primary stop');

	const SORTED_VALID = [...idna.VALID].sort((a, b) => a - b);
	function valid_indexed(v) {
		return reindex(v, SORTED_VALID).filter(x => x >= 0);
	}

	const SORTED_EMOJI = [...uts51.STYLE_DROP, ...uts51.STYLE_REQ].sort((a, b) => a - b);
	
	let combining_marks = set_intersect(read_combining_marks(), idna.VALID);

	let enc = new Encoder();
	encode_idna(enc, idna);

	enc.write_member(reindex(combining_marks, SORTED_VALID));
	
	enc.write_member(uts51.KEYCAP_DROP);
	enc.write_member(uts51.KEYCAP_REQ);
	enc.write_member(uts51.STYLE_DROP);
	enc.write_member(uts51.STYLE_REQ);
	enc.write_member(reindex(uts51.MODIFIER, SORTED_EMOJI));
	enc.write_member(reindex(uts51.MOD_BASE, SORTED_EMOJI));

	encode_seq(enc, Array.from(uts51.SEQS, explode_cp));
	encode_zwj(enc, uts51, SORTED_EMOJI);

	let {virama_index, ...nf} = read_nf_rules();
	encode_nf(enc, nf);

	enc.unsigned(virama_index);

	/*
	enc.write_member(context.T, idna.VALID);
	enc.write_member(set_union(context.L, context.D));
	enc.write_member(set_union(context.R, context.D));

	enc.write_member(set_complement(context.T, idna.VALID));
	enc.write_member(set_complement(set_union(context.L, context.D), idna.VALID));
	enc.write_member(set_complement(set_union(context.R, context.D), idna.VALID));
	*/

	let jt = map_values(read_context_joining_types(), cps => cps.filter(cp => idna.VALID.has(cp)));

	enc.write_member(valid_indexed(jt.T));
	enc.write_member(valid_indexed([...jt.L, ...jt.D]));
	enc.write_member(valid_indexed([...jt.R, ...jt.D]));

	// // https://www.unicode.org/reports/tr39/#highly_restrictive
	let script_map = map_values(read_script_sets({level: 3}), cps => [...cps].filter(cp => idna.VALID.has(cp)));

	// remove inactive scripts
	for (let [k, v] of Object.entries(script_map)) {
		if (v.length == 0) {
			delete script_map[k];
		}
	}

	// assert that all valid codepoints have a script
	if (set_complement(Object.values(script_map).flat(), idna.VALID).size > 0) {
		throw new Error(`Assumption wrong: characters without script`);
	}

	// reorder scripts
	let script_order = ['ALL', 'Jpan']; //, 'Grek', 'Hebr'];
	script_order = [...script_order, ...Object.keys(script_map).filter(x => !script_order.includes(x))];

	// deduplicate subsets
	encode_scripts(enc, script_order.map(x => {
		let cps = script_map[x];
		if (!cps) throw new Error(`Assumption wrong: missing script: ${x}`);
		return reindex(cps, SORTED_VALID);
	}));


	
	let {whole, global, per} = JSON.parse(readFileSync(join(base_dir, 'output/confusing.json')));

	encode_seq(enc, whole.map(s => reindex(explode_cp(s), SORTED_VALID)));
	encode_seq(enc, global.map(s => reindex(explode_cp(s), SORTED_VALID)));
	for (let abbr of script_order) {
		encode_seq(enc, (per[abbr] ?? []).map(s => reindex(explode_cp(s), SORTED_VALID)));
	}
	
	let bidi = read_bidi_rules();
	enc.write_member(valid_indexed([bidi.R, bidi.AL].flat()));
	enc.write_member(valid_indexed(bidi.L));
	enc.write_member(valid_indexed(bidi.AN));
	enc.write_member(valid_indexed(bidi.EN));
	enc.write_member(valid_indexed([bidi.ES, bidi.CS, bidi.ET, bidi.ON, bidi.BN].flat()));
	enc.write_member(valid_indexed(bidi.NSM));

	write_payload(`v2`, enc, {
		valid: idna.VALID,
		mapped: idna.MAPPED,
		ignored: idna.IGNORED,
		combining_marks,
		keycap_legacy: uts51.KEYCAP_DROP,
		keycap_required: uts51.KEYCAP_REQ,
		style_legacy: uts51.STYLE_DROP,
		style_required: uts51.STYLE_REQ,
		emoji_modifier: uts51.MODIFIER,
		emoji_modifier_base: uts51.MOD_BASE,
		whitelist_seq: [...uts51.SEQS].map(explode_cp),
		whitelist_zwj: [...uts51.ZWJS].map(explode_cp),
		context: jt,
		bidi,
		scripts: script_map,
		normalized_forms: nf
	});
}

function write_v1_payload({idna, uts51}) {
	if (uts51.STYLE_OPT.size > 0) throw new Error('optional style not supported');

	if (idna.extract_stops().size != 1) throw new Error('expected one stop');
	
	let combining_marks = set_intersect(read_combining_marks(), idna.VALID);

	let enc = new Encoder();
	encode_idna(enc, idna);
	enc.write_member(combining_marks);

	enc.write_member(uts51.KEYCAP_DROP);
	enc.write_member(uts51.KEYCAP_REQ);
	enc.write_member(uts51.STYLE_DROP);
	enc.write_member(uts51.STYLE_REQ);
	enc.write_member(uts51.MODIFIER);
	enc.write_member(uts51.MOD_BASE);

	encode_seq(enc, uts51);
	encode_zwj(enc, uts51);

	let {virama_index, ...nf} = read_nf_rules();
	encode_nf(enc, nf);

	let context = read_context_rules();
	//encode_context(enc, context, virama_index);
	enc.unsigned(virama_index);
	enc.write_member(context.T);
	enc.write_member(set_union(context.L, context.D));
	enc.write_member(set_union(context.R, context.D));
	enc.write_member(context.Greek);
	enc.write_member(context.Hebrew);
	enc.write_member([context.Hiragana, context.Katakana, context.Han].flat()); 

	let bidi = read_bidi_rules();
	encode_bidi(enc, bidi);

	write_payload(`v1`, enc, {
		valid: idna.VALID,
		mapped: idna.MAPPED,
		ignored: idna.IGNORED,
		combining_marks,
		keycap_legacy: uts51.KEYCAP_DROP,
		keycap_required: uts51.KEYCAP_REQ,
		style_legacy: uts51.STYLE_DROP,
		style_required: uts51.STYLE_REQ,
		emoji_modifier: uts51.MODIFIER,
		emoji_modifier_base: uts51.MOD_BASE,
		whitelist_seq: [...uts51.SEQS].map(explode_cp),
		whitelist_zwj: [...uts51.ZWJS].map(explode_cp),
		context,
		bidi,
		normalized_forms: nf
	});
}


