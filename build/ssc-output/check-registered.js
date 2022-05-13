import {join} from 'path';
import {readFileSync} from 'fs';
import {explode_cp, parse_cp} from '../utils.js';

import REGISTERED from '../../test/data/eth-labels.js';

let base_dir = new URL('.', import.meta.url).pathname;

let samples = {
"aa":["aa","ꜳ"],
"ae":["ae","æ"],
"ao":["ao","ꜵ"],
"au":["au","ꜷ"],
"av":["av","ꜹ","ꜻ"],
"ay":["ay","ꜽ"],
"dȝ":["dȝ","ʤ"],
"dz":["dz","ʣ"],
"dʑ":["dʑ","ʥ"],
"ǝo":["ǝo","ᴔ"],
"ǝo̸":["ǝo̸","ꭁ"],
"ǝo̵":["ǝo̵","ꭂ"],
"fŋ":["fŋ","ʩ"],
"ll":["ll","ǁ"],
"ls":["ls","ʪ"],
"lȝ":["lȝ","ɮ"],
"lz":["lz","ʫ"],
"tɕ":["tɕ","ʨ"],
"tf":["tf","ꝷ"],
"ts":["ts","ʦ"],
"tʃ":["tʃ","ʧ"],
"tȝ":["tȝ","ꜩ"],
"rn̦":["rn̦","ɱ"],
"rn̴":["rn̴","ᵯ"],
};

//console.log(.join(''));


//let odd_set = new Set(explode_cp('æ'));
//let odd_set = new Set(Object.values(samples).flatMap(v => v.slice(1)).map(s => explode_cp(s)).filter(v => v.length == 1).map(v => v[0]));

let odd_set = new Set(Object.keys(JSON.parse(readFileSync(join(base_dir, '../output/cm.json')))).map(parse_cp));


//console.log(String.fromCodePoint(...odd_set));

let n = 0;
for (let label of REGISTERED) {
	let cps = explode_cp(label);
	if (cps.some(cp => odd_set.has(cp))) {
		n++;
	}
}
console.log(n);