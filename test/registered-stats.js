import REGISTERED from './data/eth-labels.js';
import {escape_unicode} from '../build/utils.js';

console.log(REGISTERED.size);

console.log([...REGISTERED].reduce((max, s) => Math.max(max, [...s].length), 0));

console.log([...REGISTERED].reduce((v, s) => {
	let u = [...s];
	return u.length > v.length ? u : v;
}, []).join(''));

//console.log([...REGISTERED].filter(x => x.startsWith('\u{110B}')).map(escape_unicode));