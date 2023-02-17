import {MAX_CP, parse_cp, parse_cp_range, parse_cp_sequence, hex_cp, hex_seq, explode_cp, quote_cp, require_cp} from './utils.js';
import {readFileSync} from 'node:fs';
import UNPRINTABLES from './unprintables.js';

export function read_excluded_scripts() {
	 return JSON.parse(readFileSync(new URL('./data/scripts-excluded.json', import.meta.url)));
}

export function read_limited_scripts() {
	return JSON.parse(readFileSync(new URL('./data/scripts-limited.json', import.meta.url)));
}

export const AUGMENTED_ALL = 'ALL';

export const SCRIPT_TYPE_EXCLUDED = 'Excluded';
export const SCRIPT_TYPE_LIMITED_USE = 'LimitedUse';

// https://www.unicode.org/reports/tr39/#Mixed_Script_Detection
export function augment_script_set(set) {
	if (set.has('Hani')) {
		set.add('Hanb');
		set.add('Jpan');
		set.add('Kore');
	}
	if (set.has('Hira')) set.add('Jpan');
	if (set.has('Kana')) set.add('Jpan');
	if (set.has('Hang')) set.add('Kore');
	if (set.has('Bopo')) set.add('Hanb');
	if (set.has('Zyyy') || set.has('Zinh')) {
		set.clear();
		set.add(AUGMENTED_ALL);
	}
	return set;
}

export function unescape_unicode_str(s) {
	return s.replace(/\\x{([0-9a-f]{2,})}/g, (_, x) => String.fromCodePoint(parseInt(x, 16)));
}

export function parse_semicolon_file(file, impl = {}) {
	let scope = {
		root: {},
		row([src, cls]) {
			this.get_bucket(cls).push(src);
		},
		...impl,
		get_bucket(key) {
			if (!key) throw new Error(`empty bucket key`);
			let bucket = root[key];
			if (!bucket) bucket = root[key] = [];
			return bucket;
		} 
	};
	let {root, row, comment} = scope;
	for (let line of readFileSync(file, {encoding: 'utf8'}).split('\n')) {
		let rest;
		let pos = line.indexOf('#');
		if (pos >= 0) {
			rest = line.slice(pos + 1).trim();
			line = line.slice(0, pos).trim();
		}
		try {
			if (line) {
				row?.call(scope, line.split(';').map(s => s.trim()), rest);
			} else if (rest) {
				comment?.call(scope, rest);
			}
		} catch (err) {
			console.log(`Error parsing: ${file}`);
			console.log(line);
			throw err;
		}
	}
	return root;
}

export class UnicodeChar {
	constructor(v) {
		if (!v) return; 
		if (v.length != 15) throw new Error(`missing columns`);
		this.cp = parse_cp(v[0]);
		this.name = v[1];
		this.old_name = v[10];
		this.gc = v[2]; // general category
		this.cc = parseInt(v[3]); // combining class
		this.bidi_class = v[4];
		this.bidi_mirrored = v[9] === 'Y';
		this.iso_comment = v[11];
		// "" | "<tag>" | "XXXX YYYY" | "<tag>XXXX YYYY"
		let temp = v[5];
		if (temp.startsWith('<')) {
			let pos = temp.indexOf('>');
			if (pos == -1) throw new Error('expected closing bracket');
			this.decomp_type = temp.slice(1, pos);
			temp = temp.slice(pos + 1).trim();
			if (temp) this.decomp = parse_cp_sequence(temp);
		} else if (temp) {
			this.decomp = parse_cp_sequence(temp);
		}
		temp = v[6];
		if (temp) this.dec = parseInt(temp);
		temp = v[7];
		if (temp) this.digit = parseInt(temp);
		temp = v[8];
		if (temp) this.numer = parseInt(temp);
		temp = v[12];
		if (temp) this.upper = parse_cp(temp);
		temp = v[13];
		if (temp) this.lower = parse_cp(temp);
		temp = v[14];
		if (temp) this.title = parse_cp(temp);
	}
	get is_cm() {
		return this.gc.startsWith('M');
	}
	get is_nsm() {
		switch (this.gc) {
			case 'Mn':
			case 'Me': return true;
		}
	}
	get_name(use_short) {
		let {name, range, short, old_name} = this;
		if (use_short && short) return short;
		if (range) {
			let {prefix, cp0, cp1} = range;
			return `${prefix}-${hex_cp(this.cp)} [${1+this.cp-cp0}/${1+cp1-cp0}]`;
		}
		if (name === '<control>' && old_name) return old_name;
		return name;
	}
	get_extended() {
		return this.extended ?? [this.script];
	}
}

export class UnicodeSpec {
	constructor(data_dir, cldr_dir) {
		this.data_dir = data_dir;
		this.cldr_dir = cldr_dir;
		this.unicode_version = JSON.parse(readFileSync(new URL('./version.json', data_dir)));
		this.cldr_version = JSON.parse(readFileSync(new URL('./version.json', cldr_dir)));
		// cache some stuff
		this.char_map = new Map(this.read_ucd().map(x => [x.cp, x]));
		this.cm = new Set([...this.char_map.values()].filter(x => x.is_cm).map(x => x.cp)); 
		// add all single char CLDR short names
		// since they are lost due to the stupid A..B syntax
		// emoji sequences already have proper names
		for (let [form, name] of Object.entries(this.read_short_names())) {
			let cps = explode_cp(form);
			if (cps.length == 1) {
				let info = this.char_map.get(cps[0]);
				if (info) {
					info.short = name;
				}
			}
		}
		let {sc} = this.read_prop_values(); // sc = Script
		// this.names = new Map(sc.map(v => [v[0], v[1]])); // abbr -> name
		let name2abbr = new Map(sc.map(v => [v[1], v[0]])); // name -> abbr
		this.script_map = new Map(this.read_scripts().map(([name, cps]) => {
			let abbr = name2abbr.get(name);
			if (!abbr) throw new TypeError(`unknown script: ${name}`);
			name = name.replaceAll('_', ' '); // fix name
			let map = new Map(cps.map(cp => [cp, this.require_char(cp)]));
			let script = new UnicodeScript(abbr, name, map);
			for (let info of map.values()) {
				info.script = script;
			}
			return [abbr, script];
		}));
		// ensure that every character has a script
		// "All code points not explicitly listed for Script have the value Unknown (Zzzz)."
		let script0 = new UnicodeScript('Zzzz', 'Unknown', new Map());
		this.script_map.set(script0.abbr, script0);
		for (let char of this.char_map.values()) {
			if (!char.script) {
				char.script = script0;
				script0.map.set(char.cp, char);
			}
		}
		for (let [cp, abbrs] of this.read_script_extensions()) {
			let scripts = abbrs.sort().map(abbr => this.require_script(abbr)); // sorted, assume unique
			let info = this.char_map.get(cp);
			if (!info) throw new TypeError(`expected char: ${hex_cp(cp)}`)
			info.extended = scripts;
			/*
			info.script.ext_loss.add(cp);
			for (let script of scripts) {
				script.ext_gain.add(cp);
			}
			*/
		}
		script0.type = SCRIPT_TYPE_EXCLUDED;		
		for (let abbr of read_excluded_scripts()) {
			this.require_script(abbr).type = SCRIPT_TYPE_EXCLUDED;
		}
		for (let abbr of read_limited_scripts()) {
			this.require_script(abbr).type = SCRIPT_TYPE_LIMITED_USE;
		}
	}
	read_ucd() {
		// https://www.unicode.org/reports/tr44/#UnicodeData.txt
		// 0000;<control>;Cc;0;BN;;;;;N;NULL;;;;
		// 0031;DIGIT ONE;Nd;0;EN;;1;1;1;N;;;;;
		// 00C0;LATIN CAPITAL LETTER A WITH GRAVE;Lu;0;L;0041 0300;;;;N;LATIN CAPITAL LETTER A GRAVE;;;00E0;
		// 4E00;<CJK Ideograph, First>;Lo;0;L;;;;;N;;;;;
		// 9FFF;<CJK Ideograph, Last>;Lo;0;L;;;;;N;;;;;
		return parse_semicolon_file(new URL('./UnicodeData.txt', this.data_dir), {		
			root: [],
			row(v) {
				let char = new UnicodeChar(v);
				if (char.name.endsWith(', Last>')) {
					let first = this.root.pop();
					if (!first.name.endsWith(', First>')) throw new Error(`expected first`);
					let prefix = first.name.slice(1, -8);
					let cp0 = first.cp;
					let cp1 = char.cp;
					/*
					first.name = first.cp = undefined;
					char.name = char.cp = undefined;
					if (JSON.stringify(first) !== JSON.stringify(char)) {
						console.log(first);
						console.log(char);
						throw 1;
					}
					*/
					let range = {cp0, cp1, prefix};
					for (let cp = cp0; cp <= cp1; cp++) {
						let temp = new UnicodeChar();
						Object.assign(temp, char);
						temp.cp = cp;
						temp.name = prefix;
						temp.range = range;
						this.root.push(temp);
					}
				} else {
					this.root.push(char);
				}
			}
		});
	}

	is_printable(cp) {
		return this.char_map.has(cp) && !UNPRINTABLES.has(cp);
	}
	safe_str(cps, escape) {
		// im not sure why this is so fucked up in system fonts
		// some characters have their own dotted-circle?
		// it varies per platform and font
		// https://scriptsource.org/cms/scripts/page.php?item_id=entry_detail&uid=vr82t8n6pt
		// https://marc.durdin.net/2015/01/how-to-rendering-combining-marks-consistently-across-platforms-a-long-story/
		if (Number.isInteger(cps)) cps = [cps];
		if (!Array.isArray(cps)) throw new TypeError(`expected cps`);
		if (!cps.length) return '';
		let buf = [];
		if (this.is_printable(cps[0]) && this.cm.has(cps[0])) buf.push('◌'); // DOTTED CIRCLE
		let prev = 0;
		let n = cps.length;
		for (let i = 0; i < n; i++) {
			let cp = cps[i];
			if (!this.is_printable(cp)) {
				buf.push(String.fromCodePoint(...cps.slice(prev, i)));
				buf.push(escape ? quote_cp(cp) : '\u{FFFD}');
				prev = i + 1;
			}
		}
		buf.push(String.fromCodePoint(...cps.slice(prev, n)));
		return buf.join('');
	}
	require_script(abbr) {
		let script = this.script_map.get(abbr);
		if (!script) throw new TypeError(`unknown script abbr: ${abbr}`);
		return script;
	}
	get_script(cp) {
		return this.char_map.get(cp)?.script;
	}
	get_script_set(x) {
		let ret = new Set();
		for (let cp of explode_cp(x)) {
			let script = this.get_script(cp);
			if (script) {
				ret.add(script);
			}
		}
		return ret;
	}
	get_extended_script_set(x) {
		let ret = new Set();
		for (let cp of explode_cp(x)) {
			let info = this.char_map.get(cp);
			if (!info) continue;
			let {extended, script} = info;
			if (extended) {
				for (let x of extended) {
					ret.add(x);
				}
			} else if (script) {
				ret.add(script);
			}
		}
		return ret;
	}
	get_augmented_script_set(x) {
		return augment_script_set(this.get_extended_script_set(x));
	}
	get_resolved_script_set(x) {
		// https://www.unicode.org/reports/tr39/#def-resolved-script-set
		let cps = explode_cp(x);
		if (!cps.length) return new Set();
		let resolved = this.get_augmented_script_set(cps[0]);
		for (let i = 1; i < cps.length; i++) {
			let set = this.get_resolved_script_set(cps[i]);
			if (set.has(AUGMENTED_ALL)) continue;
			if (resolved.has(AUGMENTED_ALL)) {
				resolved = set;
			} else {
				for (let abbr of set) {
					if (!resolved.has(abbr)) {
						resolved.delete(abbr);
					}
				}
				for (let abbr of resolved) {
					if (!set.has(abbr)) {
						resolved.delete(abbr);
					}
				}

			}
		}
		return resolved;
	}
	get_noncharacter_cps() {
		// https://www.unicode.org/versions/corrigendum9.html
		/*
		let cps = parse_cp_range('FDD0..FDEF');
		for (let i = 0, j = 0xFFFE; i <= 16; i++, j += 0x10000) {
			cps.push(j, j+1);
		}
		return cps;
		*/
		return this.read_props().Noncharacter_Code_Point;
	}
	get_unnamed_cps() {
		let cps = [];
		for (let cp = 0; cp < MAX_CP; cp++) {
			if (!this.char_map.has(cp)) {
				cps.push(cp);
			}
		}
		return cps;
	}
	require_char(cp) {
		let char = this.char_map.get(cp);
		if (!char) throw new TypeError(`invalid codepoint: ${hex_cp(cp)}`);
		return char;		
	}
	get_display(cp) {
		return this.safe_str(cp);
	}
	get_name(cp, use_short) {		
		let char = this.char_map.get(cp);
		if (!char) return `???-${hex_cp(cp)}`;
		return char.get_name(use_short);
	}
	format(x, ...a) {
		let ret;
		if (typeof x === 'number') {
			let form = String.fromCodePoint(x);
			if (this.cm.has(x)) {
				form = '◌' + form; // DOTTED CIRCLE
			}
			ret = `${hex_cp(x)} (${form}) ${this.get_name(x)}`;
		} else if (Array.isArray(x)) {
			ret = x.length === 1 ? this.format(x[0]) : hex_seq(x);
		} else if (typeof x.cp === 'number') {
			ret = `${hex_cp(x.cp)} (${String.fromCodePoint(x.cp)}) ${x.name}`;
		} else {
			ret = `${hex_seq(x.cps) } (${String.fromCodePoint(...x.cps)}) ${x.name}`;
		}
		if (a.length) {
			ret = `${ret} => ${this.format(...a)}`;
		}		
		// 00..19 <control>
		// 7F     DEL
		// 202D   LTR OVERRIDE
		// 202E   RTL OVERRIDE
		return ret.replace(/[\x00-\x19\x7F\u202E\u202D]/gu, '?');
	}
	read_short_names() { // {"feof-less-form" => name:string}
		return JSON.parse(readFileSync(new URL(`./short-names.json`, this.cldr_dir)));
	}
	read_props() {
		// 0009..000D    ; White_Space # Cc   [5] <control-0009>..<control-000D>
		// 0020          ; White_Space # Zs       SPACE
		return parse_semicolon_file(new URL('./PropList.txt', this.data_dir), {
			row([src, type]) {
				this.get_bucket(type).push(...parse_cp_range(src));
			}
		});
	}
	core_props() {
		// 002B          ; Math # Sm       PLUS SIGN
		// 003C..003E    ; Math # Sm   [3] LESS-THAN SIGN..GREATER-THAN SIGN
		return parse_semicolon_file(new URL('./DerivedCoreProperties.txt', this.data_dir), {
			row([src, type]) {
				this.get_bucket(type).push(...parse_cp_range(src));
			}
		});
	}
	read_prop_values() {
		// AHex; N ; No ; F ; False
		//sc ; Latn ; Latin
		return parse_semicolon_file(new URL('./PropertyValueAliases.txt', this.data_dir), {
			row([key, ...a]) {
				this.get_bucket(key).push(a);
			}
		});
	}
	read_scripts() {
		// WARNING: returns full names
		// 0000..001F    ; Common # Cc  [32] <control-0000>..<control-001F>
		// 0020          ; Common # Zs       SPACE
		return Object.entries(parse_semicolon_file(new URL('./Scripts.txt', this.data_dir), {
			row([src, type]) {
				this.get_bucket(type).push(...parse_cp_range(src));
			}
		}));
	}
	read_script_extensions() { // abbrs
		// 102E0         ; Arab Copt # Mn       COPTIC EPACT THOUSANDS MARK
		// 102E1..102FB  ; Arab Copt # No  [27] COPTIC EPACT DIGIT ONE..COPTIC EPACT NUMBER NINE HUNDRED
		return parse_semicolon_file(new URL('./ScriptExtensions.txt', this.data_dir), {
			root: [],
			row([src, abbrs]) {
				let cps = parse_cp_range(src);
				abbrs = abbrs.trim().split(/\s+/);
				for (let cp of cps) {
					this.root.push([cp, abbrs]); // not cloned
				}
				/*
				for (let abbr of abbrs.trim().split(/\s+/)) {
					this.get_bucket(abbr).push(...cps);
				}*/
			}
		});
	}
	combining_ranks() {
		// return list of codepoints in order by increasing combining class
		// skips class 0
		let map = new Map();
		for (let char of this.char_map.values()) {
			let {cp, cc} = char;
			if (cc > 0) {
				let bucket = map.get(cc);
				if (!bucket) {
					bucket = [];
					map.set(cc, bucket);
				}
				bucket.push(cp);
			}
		}
		return [...map.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]);
	}
	decompositions(compat = false) {
		// "Conversely, the presence of a formatting tag also indicates that the mapping is a compatibility mapping and not a canonical mapping."
		return [...this.char_map.values()].filter(x => x.decomp && (compat || !x.decomp_type)).map(x => [x.cp, x.decomp]);
	}
	read_composition_exclusions() {
		// 0958    #  DEVANAGARI LETTER QA
		return parse_semicolon_file(new URL('./CompositionExclusions.txt', this.data_dir), {
			root: [],
			row([src]) {
				this.root.push(parse_cp(src));
			}	
		});
	}
	read_emoji_zwjs() {
		// 1F468 200D 2764 FE0F 200D 1F468 ; RGI_Emoji_ZWJ_Sequence  ; couple with heart: man, man # E2.0   [1] (👨‍❤️‍👨)	
		return parse_semicolon_file(new URL('./emoji-zwj-sequences.txt', this.data_dir), {
			row([src, type, name], comment) {
				let cps = parse_cp_sequence(src);
				let version = parse_version_from_comment(comment);
				this.get_bucket(type).push({cps, type, name, version});
			}
		});
	}
	read_emoji_seqs() {
		//231A..231B    ; Basic_Emoji                  ; watch                              # E0.6   [2] (⌚..⌛)
		//25AB FE0F     ; Basic_Emoji                  ; white small square                 # E0.6   [1] (▫️)
		//0023 FE0F 20E3; Emoji_Keycap_Sequence        ; keycap: \x{23}                     # E0.6   [1] (#️⃣)
		//1F1E6 1F1E8   ; RGI_Emoji_Flag_Sequence      ; flag: Ascension Island             # E2.0   [1] (🇦🇨)
		//1F3F4 E0067 E0062 E0065 E006E E0067 E007F; RGI_Emoji_Tag_Sequence; flag: England  # E5.0   [1] (🏴󠁧󠁢󠁥󠁮󠁧󠁿)
		//261D 1F3FB    ; RGI_Emoji_Modifier_Sequence  ; index pointing up: light skin tone # E1.0   [1] (☝🏻)
		const self = this;
		return parse_semicolon_file(new URL('./emoji-sequences.txt', this.data_dir), {
			row([src, type, name], comment) {
				let version = parse_version_from_comment(comment);
				name = unescape_unicode_str(name); // fix \x{}
				if (src.includes('..')) {
					let range = parse_cp_range(src).map(cp => {
						return {cps: [cp], type, name: self.get_name(cp, true), version};
					});
					this.get_bucket(type).push(...range);
				} else {
					let cps = parse_cp_sequence(src);
					this.get_bucket(type).push({cps, type, name, version});
				}
			}
		});
	}
	read_emoji_data() {
		// 0023          ; Emoji                # E0.0   [1] (#️)       hash sign
		// 0030..0039    ; Emoji                # E0.0  [10] (0️..9️)    digit zero..digit nine
		// 261D          ; Emoji_Modifier_Base  # E0.6   [1] (☝️)       index pointing up
		// 0023          ; Emoji_Component      # E0.0   [1] (#️)       hash sign
		// 00A9          ; Extended_Pictographic# E0.6   [1] (©️)       copyright
		const self = this;
		return parse_semicolon_file(new URL('./emoji-data.txt', this.data_dir), {
			row([src, type], comment) {
				let version = parse_version_from_comment(comment);
				for (let cp of parse_cp_range(src)) {
					let name = self.get_name(cp, true);
					let name0 = self.get_name(cp, false);
					if (name === name0) name0 = undefined;
					this.get_bucket(type).push({cp, type, name, name0, version});
				}
			}
		});
	}
	read_emoji_test() {
		// # group: Smileys & Emotion
		// # subgroup: face-smiling
		// 263A FE0F ; fully-qualified     # ☺️ E0.6 smiling face
		// 263A ; unqualified         # ☺ E0.6 smiling face
		return parse_semicolon_file(new URL('./emoji-test.txt', this.data_dir), {
			root: [],			
			row([src, type]) {
				let cps = parse_cp_sequence(src);
				let {group, subgroup} = this; // these needed?
				this.root.push({cps, type, group, subgroup});
			},
			comment(s) {
				let match;
				if (match = s.match(/^group:(.*)$/)) {
					this.group = match[1].trim();
				} else if (match = s.match(/^subgroup:(.*)$/)) {
					this.subgroup = match[1].trim();
				}
			}
		});
	}
	/*
	emoji_skin_colors() {
		// warning: this sucks
		// 1F3FB..1F3FF  ; Emoji_Component      # E1.0   [5] (🏻..🏿)    light skin tone..dark skin tone
		return this.emoji_data().Emoji_Component.filter(x => /\b(FITZPATRICK)\b/i.test(x.name));
	}
	emoji_hair_colors() {
		// warning: this sucks
		// 1F9B0..1F9B3  ; Emoji_Component      # E11.0  [4] (🦰..🦳)    red hair..white hair
		return this.emoji_data().Emoji_Component.filter(x => /\b(HAIR|BALD)\b/i.test(x.name));
	}
	regional_indicators() {
		return this.props().Regional_Indicator;
	}
	regions() {
		return JSON.parse(readFileSync(new URL('./regions.json', this.cldr_dir)));
	}
	derive_emoji_flag_sequences() {
		let regions = this.regions(); 
		let cps = this.regional_indicators();
		if (cps.length != 26) throw new Error('expected 26 regionals'); // meh
		let dx = cps[0] - 0x41; // 'A'
		return regions.map(region => {
			let cps = explode_cp(region).map(x => x + dx);
			let name = `Flag Sequence: ${region}`;
			let type = 'DerivedFlagSequence';
			return {cps, name, type};
		});
	}
	*/
	derive_idna_rules({version, use_STD3, valid_deviations}) {
		switch (version) {
			case 2003:
			case 2008: break;
			default: throw new TypeError(`unknown IDNA version: ${version}`);
		}
		let {
			valid, valid_NV8, valid_XV8,
			deviation_mapped, deviation_ignored,
			disallowed, disallowed_STD3_mapped, disallowed_STD3_valid,
			ignored, mapped, ...extra
		} = parse_semicolon_file(new URL('./IdnaMappingTable.txt', this.data_dir), {
			row([src, type, dst, status]) {
				if (!src) throw new Error('bug: expected src');
				if (type == 'deviation') type = dst ? 'deviation_mapped' : 'deviation_ignored';
				if (status) type = `${type}_${status}`; // NV8/XV8
				let bucket = this.get_bucket(type);
				if (type.includes('mapped')) {
					if (!dst) throw new Error('bug: expected dst');
					bucket.push([src, dst]);
				} else {
					bucket.push(src); 
				}
			}
		});
		if (Object.keys(extra).length) {
			throw new Error(`bug: unused IDNA keys: ${Object.keys(extra)}`);
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
		valid = valid.flatMap(parse_cp_range);
		let valid_set = new Set(valid);
		ignored = ignored.flatMap(parse_cp_range);
		if (ignored.some(cp => valid_set.has(cp))) throw new Error(`bug: ignored is valid!`);
		// we need to re-apply the rules to the mapped output
		// x:[char] => ys:[char, char, ...]
		mapped = mapped.flatMap(([src, dst]) => {
			let cps = parse_cp_sequence(dst);
			return cps.every(cp => valid_set.has(cp)) ? parse_cp_range(src).map(x => [x, cps]) : [];
		});
		return {valid, ignored, mapped};
	}
	read_nf_props() {
		// 037A        ; FC_NFKC                     ; 0020 03B9 # Lm GREEK YPOGEGRAMMENI
		// 11127       ; NFKC_QC                     ; M         # Mn CHAKMA VOWEL SIGN A
		// 1F73        ; Full_Composition_Exclusion              # L& GREEK SMALL LETTER EPSILON WITH OXIA
		// 00C0..00C5  ; Expands_On_NFD                          # L& [6] LATIN CAPITAL LETTER A WITH GRAVE..LATIN CAPITAL LETTER A WITH RING ABOVE
		return parse_semicolon_file(new URL('./DerivedNormalizationProps.txt', this.data_dir), {
			row([src, type, value]) {
				if (type.endsWith('_QC')) {
					let bucket = this.get_bucket(type);
					for (let cp of parse_cp_range(src)) {
						bucket.push([cp, value]);
					}
				} else if (type.startsWith('FC_')) {
					this.get_bucket(type).push([parse_cp(src), parse_cp_sequence(value)]);
				} else { 
					this.get_bucket(type).push(...parse_cp_range(src));
				}
			}
		});
	}
	read_nf_tests() {
		return parse_semicolon_file(new URL('./NormalizationTest.txt', this.data_dir), {
			row([src, nfc, nfd], comment) {
				if (src.startsWith('@')) {
					this.test = this.get_bucket(comment.trim());
				} else {
					let {test} = this;
					if (!test) throw new Error('expected test');
					test.push([src, nfd, nfc].map(s => String.fromCodePoint(...parse_cp_sequence(s))));
				}
			}	
		});
	}
	read_confusables() {
		// returns entries: [[target, cps], ...]
		// thes are SINGLE CHARCTERS that confuse with a SEQUENCE
		// Each line in the data file has the following format: 
		// - Field 1 is the source, 
		// - Field 2 is the target,
		// - Field 3 is obsolete, always containing the letters “MA” for backwards compatibility. 
		// 06E8 ;	0306 0307 ;	MA	# ( ۨ → ̆̇ ) ARABIC SMALL HIGH NOON → COMBINING BREVE, COMBINING DOT ABOVE
		// 0310 ;	0306 0307 ;	MA	# ( ̐ → ̆̇ ) COMBINING CANDRABINDU → COMBINING BREVE, COMBINING DOT ABOVE
		return Object.entries(parse_semicolon_file(new URL('./confusables.txt', this.data_dir), {
			row([src, target]) {
				let key = String.fromCodePoint(...parse_cp_sequence(target));
				this.get_bucket(key).push(parse_cp(src));
			}
		})).map(([key, cps]) => [explode_cp(key), cps]);
	}
	read_intentional_confusables() { 
		// returns list of pairs
		// 0021 ;	01C3	#* ( ! ~ ǃ ) EXCLAMATION MARK ~ LATIN LETTER RETROFLEX CLICK
		return parse_semicolon_file(new URL('./intentional.txt', this.data_dir), {
			root: [],
			row([a, b]) {
				this.root.push([parse_cp(a), parse_cp(b)]);
			}
		});
	}
	read_allowed_identifiers() { 
		// returns list of codepoints
		// 002D..002E ; Allowed    # 1.1    [2] HYPHEN-MINUS..FULL STOP
		return parse_semicolon_file(new URL('./IdentifierStatus.txt', this.data_dir), {
			root: [],
			row([src, type]) {
				if (type !== 'Allowed') throw new Error(`bug: unexpected type: ${type}`);
				this.root.push(...parse_cp_range(src));
			}
		});
	}
	read_identifier_types() { 
		// returns map of name => codepoints
		return parse_semicolon_file(new URL('./IdentifierType.txt', this.data_dir), {
			row([src, type]) {
				this.get_bucket(type).push(...parse_cp_range(src));
			}
		});
	}
}

function parse_version_from_comment(s) {
	let match = s.match(/^E(\d+.\d+)\b/);
	if (!match) throw new Error(`expected version: ${s}`);
	return match[1];
}

class UnicodeScript {
	constructor(abbr, name, map) {
		this.abbr = abbr;
		this.name = name;
		this.map = map;
		//this.ext_loss = new Set();
		//this.ext_gain = new Set();
		this.type = undefined;
	}
	get description() {
		let desc = `[${this.abbr}] ${this.name}`;
		switch (this.type) {
			case SCRIPT_TYPE_EXCLUDED:    desc = `${desc} [X]`; break;
			case SCRIPT_TYPE_LIMITED_USE: desc = `${desc} [L]`; break;
		}
		return desc;
	}
	//get description() {
	//	return `${this.name} (${this.map.size}) Ext(+${this.ext_gain.size}-${this.ext_loss.size})`;
	//}
}

/*
// work in abbrs		
export class UnicodeScripts {
	constructor(spec) {
		this.spec = spec;
		let {sc} = spec.prop_values(); // sc = Script
		// this.names = new Map(sc.map(v => [v[0], v[1]])); // abbr -> name
		let name2abbr = new Map(sc.map(v => [v[1], v[0]])); // name -> abbr
		this.map = spec.scripts().map(([name, cps]) => {
			let abbr = name2abbr.get(name);
			if (!abbr) throw new TypeError(`unknown script abbr: ${name}`);
			name = name.replaceAll('_', ' '); // fix name
			let set = new Set(cps);
			return [abbr, new UnicodeScript(abbr, name, set)];
		});
		this.exts = new Map(spec.script_extensions().map(([cp, abbrs]) => [cp, abbrs.map(abbr => this.require(abbr))]));
		for (let [cp, scripts] of this.exts) {			
			let script0 = this.get_script(cp);
			for (let script of scripts) {
				if (script === script0) {
					script0 = false;
				} else {
					script.ext_gain.add(cp);
				}
			}
			script0?.ext_loss.add(cp);
		}
		for (let abbr of read_excluded_scripts()) {
			this.require(abbr).excluded = true;
		}
		for (let abbr of read_limited_scripts()) {
			this.require(abbr).limited = true;
		}
	}
	[Symbol.iterator]() {
		return this.map.values();
	}
	require(abbr) {	
		let script = this.map.get(abbr);
		if (!script) throw new TypeError(`expected script abbr: ${abbr}`);
		return script;
	}
	excluded() { 
		return [...this].filter(x => x.excluded);
	}
	limited() { 
		return [...this].filter(x => x.limited);
	}
	get_details(cp) {
		let script = this.get_script(cp);
		let aug = this.get_extended_script_set(cp);
		let ret = script?.abbr ?? 'Unknown';
		if (script ? aug.size == 1 && aug.has(script.abbr) : aug.size == 0) {
			// same, not aug
		} else {
			ret = `${ret} => ${[...aug].join(',')}`;
		}
		return `${this.spec.get_name(cp)} [${ret}]`;
	}
	get_script(cp) {
		for (let script of this.map.values()) {
			if (script.set.has(cp)) {
				return script;
			}
		}
	}
	get_script_set(x) {
		let ret = new Set();
		for (let cp of explode_cp(x)) {
			let script = this.get_script(cp);
			if (script) {
				ret.add(script);
			}
		}
		return ret;
	}
	get_extended_script_set(x) {
		let ret = new Set();
		for (let cp of explode_cp(x)) {
			let ext = this.exts.get(cp);
			if (ext) {
				for (let x of ext) {
					ret.add(x);
				}
			} else {
				let script = this.get_script(cp);
				if (script) {
					ret.add(script);
				}
			}
		}
		return ret;
	}
	get_augmented_script_set(x) {
		return augment_script_set(this.get_extended_script_set(x));
	}
	get_resolved_script_set(x) {
		// https://www.unicode.org/reports/tr39/#def-resolved-script-set
		let cps = explode_cp(x);
		if (!cps.length) return new Set();
		let resolved = this.get_augmented_script_set(cps[0]);
		for (let i = 1; i < cps.length; i++) {
			let set = this.get_resolved_script_set(cps[i]);
			if (set.has(AUGMENTED_ALL)) continue;
			if (resolved.has(AUGMENTED_ALL)) {
				resolved = set;
			} else {
				for (let abbr of set) {
					if (!resolved.has(abbr)) {
						resolved.delete(abbr);
					}
				}
				for (let abbr of resolved) {
					if (!set.has(abbr)) {
						resolved.delete(abbr);
					}
				}

			}
		}
		return resolved;
	}
	apply_changes(map) { // abbr => [cp, ...]
		for (let [abbr, cps] of Object.entries(map)) {
			let dst = this.require(abbr);
			for (let cp of cps) {
				let src = this.get_script(cp);
				if (!src) throw new Error(`Expected script: ${this.spec.format(cp)}`);
				src.set.delete(cp);
				dst.set.add(cp);
				console.log(`Changed Script [${src.abbr} => ${dst.abbr}]: ${this.spec.format(cp)}`);
			}
		}
	}
}
*/

export class UnicodePrinter {
	constructor(spec) {
		this.spec = spec;
	}
	js_header() {
		console.log(`// Computed: ${new Date().toJSON()}`);
		console.log(`// Version: Unicode(${this.spec.unicode_version.version}) CLDR(${this.spec.cldr_version.version})`);
	}
	js(cp) {
		// Example: 0x61, // (a) LATIN SMALL LETTER A
		if (Number.isInteger(cp)) {
			return `0x${hex_cp(cp)}, // (${this.spec.get_display(cp)}) ${this.spec.get_name(cp)}`;
		} else if (Number.isInteger(cp.cp)) {
			return `0x${hex_cp(cp.cp)}, // ${this.spec.get_display(cp.cp)} ${cp.name}`;
		} else {
			throw new TypeError(`expected single cp: ${cp}`);
		}
	}
	jss(cp) {
		return `${this.js(cp)} [${this.scripts(cp)}]`;
	}
	jsstr(cp) {
		// Example: 'a', // 61 (a) LATIN SMALL LETTER A
		if (UNPRINTABLES.has(cp)) throw new TypeError(`unprintable: ${this.spec.desc_for_cp(cp)}`);
		return `'${String.fromCodePoint(cp)}', // ${hex_cp(cp)} (${this.spec.get_display(cp)}) ${this.spec.get_name(cp)}`;
	}
	md(cp) {
		// Example: * `61 (a)` LATIN SMALL LETTER A
		return `* \`${hex_cp(cp)} (${this.spec.get_display(cp)})\` ${this.spec.get_name(cp)}`;
	}
	scripts(cp) {
		let script = this.spec.get_script(cp);
		if (!script) return 'Unknown'; // no script
		let aug = this.spec.get_extended_script_set(cp);
		if (aug.size == 1 && aug.has(script)) return script.abbr; // not aug
		return `${script.abbr} => ${[...aug].map(x => x.abbr).join(',')}`;
	}
	names(cps) {
		return cps.map(cp => this.spec.get_name(cp)).join(' + '); 
	}
	desc_for_cp(cp) {
		require_cp(cp);
		return `${hex_cp(cp)} (${this.spec.get_display(cp)}) ${this.spec.get_name(cp)}`;
	}
	desc_for_cps(x) {
		let cps = explode_cp(x);
		return `${hex_seq(cps)} (${this.spec.safe_str(cps)}) ${this.names(cps)}`;
	}
	desc_for_mapped(x, ys) {
		return `${this.desc_for_cp(x)} => ${this.desc_for_cps(ys)}`; // map char
	}
	desc_for_emoji(info) {
		let cps = Array.isArray(info.cps) ? info.cps : [info.cp];
		// we can safely print emoji
		// most emoji should have a name
		let {name, name0} = info;
		if (!name) name = this.names(cps);
		if (name0) name = `${name} / ${name0}`;
		return `${hex_seq(cps)} (${String.fromCodePoint(...cps)}) ${name}`; 
	}
}

