// distribution of group types in labels

import {read_labels} from './data.js';
import {ens_split} from '../src/lib.js';

const LABELS = read_labels();

let tally = {};
for (let label of labels) {
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
let total = tally.reduce((a, x) => a + x.count, 0);

console.log(new Date().toJSON());
for (let {count, type} of tally) {
	console.log(
		(100 * count / total).toFixed(4).padStart(7)+'%', 
		String(count).padStart(7), 
		type
	);
}

/*
Loaded 2479142 labels in 2.2s
2023-02-12T01:16:21.110Z
89.1459% 2210054 ASCII
 3.5428%   87830 Latin+Emoji
 2.2930%   56846 Emoji
 1.3406%   33236 Latin
 1.1754%   29139 Arabic
 1.0842%   26880 Han
 0.7414%   18381 *** Error
 0.1423%    3528 Devanagari
 0.1089%    2701 Japanese
 0.1017%    2522 Korean
 0.0799%    1980 Cyrillic
 0.0707%    1752 Hebrew
 0.0603%    1494 Thai
 0.0360%     892 Bengali
 0.0181%     449 Tamil
 0.0130%     322 Greek
 0.0073%     181 Tibetan
 0.0046%     115 Restricted[Egyp]
 0.0041%     101 Arabic+Emoji
 0.0034%      84 Han+Emoji
 0.0031%      76 Gurmukhi
 0.0027%      68 Restricted[Mong]
 0.0024%      59 Lao
 0.0017%      41 Telugu
 0.0017%      41 Bopomofo
 0.0016%      40 Gujarati
 0.0014%      35 Georgian
 0.0013%      32 Armenian
 0.0013%      32 Restricted[Runr]
 0.0012%      29 Myanmar
 0.0010%      24 Khmer
 0.0009%      22 Malayalam
 0.0009%      22 Restricted[Cher]
 0.0008%      19 Ethiopic
 0.0006%      16 Kannada
 0.0006%      14 Japanese+Emoji
 0.0005%      12 Sinhala
 0.0004%       9 Oriya
 0.0003%       7 Korean+Emoji
 0.0002%       6 Restricted[Cans]
 0.0002%       5 Restricted[Ogam]
 0.0002%       4 Restricted[Syrc]
 0.0002%       4 Restricted[Limb]
 0.0002%       4 Restricted[Xsux]
 0.0002%       4 Restricted[Xpeo]
 0.0001%       3 Restricted[Phnx]
 0.0001%       3 Restricted[Vaii]
 0.0001%       3 Cyrillic+Emoji
 0.0001%       2 Restricted[Nkoo]
 0.0001%       2 Restricted[Talu]
 0.0001%       2 Restricted[Cham]
 0.0001%       2 Restricted[Ital]
 0.0001%       2 Thaana
 0.0001%       2 Restricted[Tglg]
 0.0001%       2 Greek+Emoji
 0.0000%       1 Restricted[Runr]+Emoji
 0.0000%       1 Restricted[Dsrt]
 0.0000%       1 Restricted[Tfng]
 0.0000%       1 Hebrew+Emoji
 0.0000%       1 Restricted[Java]
 0.0000%       1 Bopomofo+Emoji
 0.0000%       1 Restricted[Copt]+Emoji
 */