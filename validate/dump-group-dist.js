// distribution of group types in labels

import {read_labels} from './data.js';
import {ens_split} from '../src/lib.js';

const LABELS = read_labels();

let tally = {};
for (let label of LABELS) {
	let split = ens_split(label);
	if (split.length != 1) continue;
	split = split[0];
	let type;
	if (split.error) {
		type = '*** Error';
	} else {
		type = split.type;
		if (type !== 'Emoji' && split.emoji) {
			type += '+Emoji';
		}
	}
	let rec = tally[type];
	if (!rec) tally[type] = rec = {type, count: 0};
	rec.count++;
}
tally = Object.values(tally).sort((a, b) => b.count - a.count);

let perc = 6;
let count_pad = LABELS.length.toString().length;
console.log(new Date());
for (let {count, type} of tally) {
	console.log(
		(100 * count / LABELS.length).toFixed(perc).padStart(4+perc)+'%', 
		count.toString().padStart(count_pad), 
		type
	);
}

/*
2024-09-11T06:54:30.224Z
 90.404374% 2661512 ASCII
  3.121425%   91895 Latin+Emoji
  1.990246%   58593 Emoji
  1.208115%   35567 Latin
  1.036274%   30508 Han
  0.996465%   29336 Arabic
  0.641235%   18878 *** Error
  0.120550%    3549 Devanagari
  0.100985%    2973 Japanese
  0.092289%    2717 Korean
  0.074694%    2199 Cyrillic
  0.059952%    1765 Hebrew
  0.051664%    1521 Thai
  0.030333%     893 Bengali
  0.015455%     455 Tamil
  0.011855%     349 Greek
  0.006522%     192 Tibetan
  0.004789%     141 Restricted[Egyp]
  0.004416%     130 Han+Emoji
  0.003533%     104 Arabic+Emoji
  0.002649%      78 Gurmukhi
  0.002344%      69 Restricted[Mong]
  0.002106%      62 Lao
  0.001562%      46 Telugu
  0.001461%      43 Gujarati
  0.001461%      43 Bopomofo
  0.001393%      41 Myanmar
  0.001325%      39 Georgian
  0.001291%      38 Restricted[Runr]
  0.001155%      34 Armenian
  0.000849%      25 Malayalam
  0.000849%      25 Khmer
  0.000781%      23 Restricted[Cher]
  0.000747%      22 Kannada
  0.000679%      20 Ethiopic
  0.000611%      18 Japanese+Emoji
  0.000510%      15 Sinhala
  0.000306%       9 Oriya
  0.000272%       8 Restricted[Cans]
  0.000272%       8 Korean+Emoji
  0.000204%       6 Cyrillic+Emoji
  0.000170%       5 Restricted[Xsux]
  0.000170%       5 Restricted[Ogam]
  0.000136%       4 Restricted[Syrc]
  0.000136%       4 Restricted[Limb]
  0.000136%       4 Restricted[Xpeo]
  0.000102%       3 Restricted[Phnx]
  0.000102%       3 Restricted[Yiii]
  0.000102%       3 Restricted[Vaii]
  0.000068%       2 Restricted[Nkoo]
  0.000068%       2 Restricted[Talu]
  0.000068%       2 Restricted[Cham]
  0.000068%       2 Restricted[Ital]
  0.000068%       2 Thaana
  0.000068%       2 Restricted[Tglg]
  0.000068%       2 Restricted[Bamu]
  0.000068%       2 Greek+Emoji
  0.000034%       1 Restricted[Runr]+Emoji
  0.000034%       1 Restricted[Dsrt]
  0.000034%       1 Restricted[Mero]
  0.000034%       1 Restricted[Gonm]
  0.000034%       1 Restricted[Tfng]
  0.000034%       1 Restricted[Mroo]
  0.000034%       1 Hebrew+Emoji
  0.000034%       1 Restricted[Java]
  0.000034%       1 Bopomofo+Emoji
  0.000034%       1 Restricted[Copt]+Emoji
  0.000034%       1 Restricted[Orkh]
 */