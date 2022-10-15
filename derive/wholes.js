import {readdir} from 'node:fs/promises';

// https://www.unicode.org/reports/tr39/#Whole_Script_Confusables
// confusables = [target: number[], cps: number[]]
// for example:
//   237A ;	0061 ; ⍺ → a ) APL FUNCTIONAL SYMBOL ALPHA → LATIN SMALL LETTER A
//   FF41 ;	0061 ; ａ → a ) FULLWIDTH LATIN SMALL LETTER A → LATIN SMALL LETTER A
// confusables = [[0x61], [0x237A, 0xFF41]]
export function wholes_from_single(scripts, confusables, is_valid, abbr0, abbrs) {
	let script0 = scripts.require(abbr0);
	let union = new Set();
	for (let abbr of abbrs) {
		for (let cp of scripts.require(abbr).set) {
			if (is_valid(cp)) {
				union.add(cp);
			}
		}
	}
	let ret = [];	
	for (let [target, cps] of confusables) {
		let confused = cps.filter(cp => script0.set.has(cp) && is_valid(cp));
		if (!confused.length) continue;
		let matches = cps.filter(cp => union.has(cp)).map(cp => [cp]);
		if (target.every(is_valid)) {
			let cover_set = scripts.get_script_set(target);
			if (abbrs.some(abbr => cover_set.has(abbr))) {
				matches.unshift(target);
			}
		}
		if (!matches.length) continue;
		ret.push({
			target,   // target confusable
			confused, // matches from target script (abbr0)
			matches   // matches from source scripts (abbrs) -- might be empty
		});
	}
	return ret;
}

export async function read_wholes(scripts) {
	let dir = new URL('./rules/', import.meta.url);
	let ret = [];
	for (let name of await readdir(dir)) {
		let match = name.match(/^wholes\-([a-z]{4})\.js$/i);
		if (!match) continue;
		let abbr = match[1];
		let script = scripts.require(abbr);
		let cps = (await import(new URL(name, dir))).default.filter(cp => {
			return script.set.has(cp);
		});
		script.wholes = new Set(cps);
		ret.push(script);
	}
	return ret;
}
