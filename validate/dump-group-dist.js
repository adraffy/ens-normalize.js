// distribution of group types in labels

import {read_labels} from './data.js';
import {ens_split} from '../src/lib.js';

const LABELS = read_labels();

let tally = {};
for (let label of LABELS) {
	let split = ens_split(label);
	if (split.length != 1) throw new Error('wtf');
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
console.log(new Date().toJSON());
for (let {count, type} of tally) {
	console.log(
		(100 * count / LABELS.length).toFixed(perc).padStart(4+perc)+'%', 
		count.toString().padStart(count_pad), 
		type
	);
}

/*
Loaded 2479142 labels in 2.1s
2023-02-12T23:57:39.729Z
 89.145922% 2210054 ASCII
  3.542758%   87830 Latin+Emoji
  2.292971%   56846 Emoji
  1.340625%   33236 Latin
  1.175366%   29139 Arabic
  1.084246%   26880 Han
  0.741426%   18381 *** Error
  0.142307%    3528 Devanagari
  0.108949%    2701 Japanese
  0.101729%    2522 Korean
  0.079866%    1980 Cyrillic
  0.070670%    1752 Hebrew
  0.060263%    1494 Thai
  0.035980%     892 Bengali
  0.018111%     449 Tamil
  0.012988%     322 Greek
  0.007301%     181 Tibetan
  0.004639%     115 Restricted[Egyp]
  0.004074%     101 Arabic+Emoji
  0.003388%      84 Han+Emoji
  0.003066%      76 Gurmukhi
  0.002743%      68 Restricted[Mong]
  0.002380%      59 Lao
  0.001654%      41 Telugu
  0.001654%      41 Bopomofo
  0.001613%      40 Gujarati
  0.001412%      35 Georgian
  0.001291%      32 Armenian
  0.001291%      32 Restricted[Runr]
  0.001170%      29 Myanmar
  0.000968%      24 Khmer
  0.000887%      22 Malayalam
  0.000887%      22 Restricted[Cher]
  0.000766%      19 Ethiopic
  0.000645%      16 Kannada
  0.000565%      14 Japanese+Emoji
  0.000484%      12 Sinhala
  0.000363%       9 Oriya
  0.000282%       7 Korean+Emoji
  0.000242%       6 Restricted[Cans]
  0.000202%       5 Restricted[Ogam]
  0.000161%       4 Restricted[Syrc]
  0.000161%       4 Restricted[Limb]
  0.000161%       4 Restricted[Xsux]
  0.000161%       4 Restricted[Xpeo]
  0.000121%       3 Restricted[Phnx]
  0.000121%       3 Restricted[Vaii]
  0.000121%       3 Cyrillic+Emoji
  0.000081%       2 Restricted[Nkoo]
  0.000081%       2 Restricted[Talu]
  0.000081%       2 Restricted[Cham]
  0.000081%       2 Restricted[Ital]
  0.000081%       2 Thaana
  0.000081%       2 Restricted[Tglg]
  0.000081%       2 Greek+Emoji
  0.000040%       1 Restricted[Runr]+Emoji
  0.000040%       1 Restricted[Dsrt]
  0.000040%       1 Restricted[Tfng]
  0.000040%       1 Hebrew+Emoji
  0.000040%       1 Restricted[Java]
  0.000040%       1 Bopomofo+Emoji
  0.000040%       1 Restricted[Copt]+Emoji
 */