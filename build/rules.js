import {read_idna_rules, read_emoji_data} from './unicode-logic.js';
import {parse_cp, parse_cp_sequence, parse_cp_range, parse_cp_multi_ranges, set_intersect, hex_cp, take_from} from './utils.js';

export class IDNA {
	constructor() {
		this.config = {};
		this.VALID = new Set();
		//this.VALID0 = new Set();
		this.IGNORED = new Set();
		//this.INVALID_SEQS = new Set(); 
		this.MAPPED = [];
	}
	static from_data(a) {
		let {valid, ignored, mapped, ...config} = read_idna_rules(a);
		let ret = new this();
		ret.config = config;
		//ret.VALID0 = new Set(valid); // copy
		ret.VALID = valid;
		ret.IGNORED = ignored;
		ret.MAPPED = mapped;
		return ret;
	}
	remove_rule(cp) {
		this.IGNORED.delete(cp);
		this.VALID.delete(cp);
		this.MAPPED = this.MAPPED.filter(([x]) => x != cp);
	}
	is_mapped(cp) {
		return this.MAPPED.some(([x]) => x == cp)
	}
	is_disallowed(cp) {
		return !this.VALID.has(cp) && !this.IGNORED.has(cp) && !this.is_mapped(cp);
	}
	/*
	allowed_set() {
		return new Set([...this.VALID, ...this.MAPPED.map(([x]) => x)]);
	}
	*/
	remove_invalid_mapped() {
		this.MAPPED = this.MAPPED.filter(([x, ys]) => {
			if (ys.every(cp => this.VALID.has(cp))) return true;
			console.log(`Removed Mapped: ${x} -> ${ys}`);
			return false;
		});
	}
	/*
	async remove_nfc_mapped() {
		let {nfc} = await import_nf();
		this.MAPPED = this.MAPPED.filter(([x, ys]) => compare_arrays(nfc([x]), ys) == 0);
	}
	*/
	check_invariants() {
		// everything in the mapped output should be valid
		for (let [x, ys] of this.MAPPED) {
			if (this.VALID.has(x)) {
				throw new Error(`Invalid rules: mapped target is valid: ${x}`);
			}
			if (this.IGNORED.has(x)) {
				throw new Error(`Invalid rules: mapped target is ignored: ${x}`);
			}
  			if (!ys.every(cp => this.VALID.has(cp))) {
				throw new Error(`Invalid rules: mapped output isn't valid: ${x} -> ${ys}`);
			}
		}
		if (set_intersect(this.VALID, this.IGNORED).size > 0) {
			throw new Error(`Invalid rules: valid intersects ignored`);
		}
	}
	check_assumptions() {
		// check some assumptions:
		// 1.) emoji styling should be ignored
		if (!this.IGNORED.has(0xFE0E)) throw new Error('Assumption wrong: FE0E not ignored');
		if (!this.IGNORED.has(0xFE0F)) throw new Error('Assumption wrong: FE0F not ignored');		
		// 2.) joiners should be valid if using context rules
		// note: this doesn't impact emoji zwj processing
		if (!this.VALID.has(0x200C)) throw new Error('Assumption wrong: ZWNJ not valid');
		if (!this.VALID.has(0x200D)) throw new Error('Assumption wrong: ZWJ not valid');		
	}
	extract_stops(primary_stop = 0x2E) {
		if (!this.VALID.delete(primary_stop)) {
			throw new Error(`Assumption wrong: Stop ${hex_cp(primary_stop)} is not valid`);
		}
		let stops = new Set([primary_stop]);
		for (let [x, ys] of take_from(this.MAPPED, ([_, ys]) => ys.includes(primary_stop))) {
			if (ys.length != 1) {
				throw new Error(`Assumption wrong: ${x} is mapped to a Stop with other characters`);
			}
			stops.add(x);
		}
		return stops;
	}
}


export class UTS51 {
	static from_data() {
		return new this(read_emoji_data());
	}
	constructor(data) {
		// sets of codepoints
		this.STYLE_DROP = new Set(); 
		this.STYLE_OPT = new Set();
		this.STYLE_REQ = new Set();
		this.NON_SOLO = new Set(); // experimental
		this.KEYCAP_DROP = new Set();
		this.KEYCAP_REQ = new Set();
		this.REGIONAL = new Set();
		this.TAG_SPEC = new Set();
		this.MOD_BASE = new Set();
		this.MODIFIER = new Set();
		// sets of strings
		this.SEQS = new Set(); 
		this.ZWJS = new Set(); 
		//this.data = data;
		this.emoji = new Set(data.Emoji);
		//this.picto = data.Extended_Pictographic.filter(cp => !this.emoji.has(cp));
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
			this.remove_style(cp); // remove from normal emoji handling 
			this.REGIONAL.add(cp); 
		}
		// assign tag spec
		for (let cp of data.tag_spec) {
			this.TAG_SPEC.add(cp); // note: these are not emoji
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
	check_assumptions() {
		// no SEQ or ZWJ should start with a modifier
		for (let s of this.SEQS) {
			if (this.MODIFIER.has(s.codePointAt(0))) {
				throw new Error(`Assumption wrong: SEQ starts with MODIFIER: ${s}`);
			}
		}
		for (let s of this.ZWJS) {
			if (this.MODIFIER.has(s.codePointAt(0))) {
				throw new Error(`Assumption wrong: ZWJ starts with MODIFIER: ${s} `);
			}
		}
		// MOD_BASE/MODIFIER should be DROP
		for (let cp of this.MOD_BASE) {
			if (!this.STYLE_DROP.has(cp)) {
				throw new Error(`Assumption wrong: MOD_BASE is not DROP: ${cp}`);
			}
		}
		for (let cp of this.MODIFIER) {
			if (!this.STYLE_DROP.has(cp)) {
				throw new Error(`Assumption wrong: MODIFIER is not DROP: ${cp}`);
			}
		}
	}
}

export function apply_rules(idna, uts51, rules) {
	for (let rule of rules) {
		try {
			let {ty, src, dst} = rule;
			switch (ty) {			
				case 'disable-tags': {
					// remove tags
					uts51.TAG_SPEC.clear();
					break;
				}
				case 'keycap-drop': {
					// proper keycaps are $CAP FE0F 20E3
					// dropped keycaps match this pattern, but strip the FE0F
					// this is supported as a 1-way downgrade
					for (let cp of parse_cp_multi_ranges(src)) {
						if (!uts51.KEYCAP_REQ.delete(cp)) {
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
					// opt matches either pattern, keeps FE0F if it was provided
					for (let cp of parse_cp_multi_ranges(src)) {
						uts51.set_style(cp, ty);
					}
					continue;
				}
				case 'emoji-zwj': {
					// add a zwj sequence
					let cps = parse_cp_sequence(src);
					uts51.ZWJS.add(String.fromCodePoint(...cps));
					continue;
				}
				case 'emoji-seq': {
					// add an emoji sequence that terminates
					let cps = parse_cp_sequence(src);
					uts51.SEQS.add(String.fromCodePoint(...cps));
					continue;
				}
				case 'demoji': {
					// remove an emoji
					// go thru text processing instead
					let cps = parse_cp_multi_ranges(src);
					if (typeof dst === 'string') {
						// allow for an inline mapping
						if (cps.length != 1) throw new Error('demoji map allows only raw cp');
						let [cp] = cps;
						idna.remove_rule(cp);
						idna.MAPPED.push([cp, parse_cp_sequence(dst)]);
					}
					for (let cp of cps) {
						if (!uts51.remove_style(cp)) throw new Error(`demoji not styled`);
						uts51.NON_SOLO.add(cp);
					}
					break;
				}
				case 'ignore': {
					for (let cp of parse_cp_multi_ranges(src)) {
						idna.remove_rule(cp);
						idna.IGNORED.add(cp);
					}
					continue;
				}
				case 'valid': {
					for (let cp of parse_cp_multi_ranges(src)) {
						idna.remove_rule(cp);
						idna.VALID.add(cp);
					}
					continue;
				}
				/*
				case 'invalid-seq': {
					let cps = parse_cp_sequence(src);
					if (cps.length < 2) throw new Error(`Expected 2+ characters`);
					idna.INVALID_SEQS.add(String.fromCodePoint(cps));
					continue;
				}
				*/
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
						idna.MAPPED.push([src, dst]);
					} else { // map [x,x+1,...] to [y,y+1,...]
						src = parse_cp_range(rule.src);
						dst = parse_cp_range(rule.dst);
						//if (dst.length == 1) dst = Array(src.length).fill(dst[0]); // map to single value
						if (src.length != dst.length) throw new Error(`length`);
						for (let i = 0; i < src.length; i++) {
							let cp = src[i];
							idna.remove_rule(cp);
							idna.MAPPED.push([cp, [dst[i]]]);
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
	idna.remove_invalid_mapped();
	idna.check_invariants();
}

export async function rules_for_adraffy() {
	let idna = IDNA.from_data({version: 2008});
	let uts51 = UTS51.from_data();
	apply_rules(idna, uts51, (await import('./rules/adraffy.js')).default);
	//await apply_confusables(idna);
	//await idna.remove_nfc_mapped();
	idna.check_assumptions();
	uts51.check_assumptions();	
	return {idna, uts51};
}

export function rules_for_ens0() {	
	return {
		idna: IDNA.from_data({version: 2003, valid_deviations: true}),
		combining_marks: new Set()
	};
}
