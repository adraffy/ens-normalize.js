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
Loaded 3350773 labels in 0.4s
2025-08-04T20:26:19.351Z
 89.124897% 2986373 ASCII
  3.492955%  117041 Latin+Emoji
  2.470564%   82783 Emoji
  1.460051%   48923 Latin
  1.102014%   36926 Arabic
  1.053011%   35284 Han
  0.678828%   22746 *** Error
  0.142504%    4775 Devanagari
  0.094187%    3156 Korean
  0.091770%    3075 Japanese
  0.072371%    2425 Cyrillic
  0.056793%    1903 Hebrew
  0.052346%    1754 Thai
  0.036857%    1235 Bengali
  0.016295%     546 Tamil
  0.011758%     394 Greek
  0.006208%     208 Tibetan
  0.004477%     150 Restricted[Egyp]
  0.004447%     149 Han+Emoji
  0.003372%     113 Arabic+Emoji
  0.002537%      85 Restricted[Mong]
  0.002388%      80 Gurmukhi
  0.001940%      65 Lao
  0.001671%      56 Telugu
  0.001462%      49 Gujarati
  0.001373%      46 Myanmar
  0.001283%      43 Bopomofo
  0.001224%      41 Georgian
  0.001164%      39 Restricted[Runr]
  0.001104%      37 Armenian
  0.000985%      33 Khmer
  0.000925%      31 Kannada
  0.000836%      28 Malayalam
  0.000806%      27 Restricted[Cher]
  0.000597%      20 Ethiopic
  0.000537%      18 Japanese+Emoji
  0.000448%      15 Sinhala
  0.000328%      11 Oriya
  0.000239%       8 Restricted[Cans]
  0.000239%       8 Korean+Emoji
  0.000209%       7 Cyrillic+Emoji
  0.000179%       6 Restricted[Xsux]
  0.000149%       5 Restricted[Ogam]
  0.000119%       4 Restricted[Syrc]
  0.000119%       4 Restricted[Limb]
  0.000119%       4 Restricted[Yiii]
  0.000119%       4 Restricted[Xpeo]
  0.000090%       3 Restricted[Phnx]
  0.000090%       3 Restricted[Vaii]
  0.000090%       3 Restricted[Mero]
  0.000060%       2 Restricted[Nkoo]
  0.000060%       2 Restricted[Talu]
  0.000060%       2 Restricted[Cham]
  0.000060%       2 Thaana
  0.000060%       2 Restricted[Tglg]
  0.000060%       2 Restricted[Ital]
  0.000060%       2 Restricted[Bamu]
  0.000060%       2 Greek+Emoji
  0.000030%       1 Restricted[Runr]+Emoji
  0.000030%       1 Restricted[Orkh]
  0.000030%       1 Restricted[Lana]
  0.000030%       1 Restricted[Glag]+Emoji
  0.000030%       1 Restricted[Tfng]
  0.000030%       1 Restricted[Cari]
  0.000030%       1 Restricted[Dsrt]
  0.000030%       1 Restricted[Brah]
  0.000030%       1 Restricted[Gonm]
  0.000030%       1 Restricted[Mroo]
  0.000030%       1 Hebrew+Emoji
  0.000030%       1 Restricted[Java]
  0.000030%       1 Bopomofo+Emoji
  0.000030%       1 Restricted[Copt]+Emoji
 */