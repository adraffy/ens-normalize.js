import {readFileSync} from 'fs';
export default readFileSync(new URL('../test/data/eth-labels-20211127-134810-rx6ulbdm52rz.csv', 
	import.meta.url).pathname, {encoding: 'utf8'}).split('\n');