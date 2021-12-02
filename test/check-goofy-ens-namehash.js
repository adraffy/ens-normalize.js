import {ens_normalize} from '../ens-normalize.js';
import lib from 'eth-ens-namehash';
import {readFileSync, writeFileSync} from 'fs';
import fetch from 'node-fetch';
import {FetchProvider, retry, ens_node_from_name, ABIEncoder, ABIDecoder} from '@adraffy/eth-tools';

let provider = retry(new FetchProvider({url: 'https://cloudflare-eth.com', fetch}));

async function get_owner(name) {
	let node = ens_node_from_name(name);
	let owner = ABIDecoder.from_hex(await provider.request({method: 'eth_call', params:[{
		to: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
		data: ABIEncoder.method('owner(bytes32)').add_hex(node).build_hex()
	}, 'latest']})).addr();
	return owner;
}

function local_file(name) {
	return new URL(name, import.meta.url).pathname;
}

async function explode(s) {
	return {label: s, points: [...s].map(x => x.codePointAt(0)).join(' '), owner: await get_owner(`${s}.eth`)};
}

let errors = [];
let diffs = [];
let labels = readFileSync(local_file('./data/eth-labels-20211127-134810-rx6ulbdm52rz.csv'), {encoding: 'utf8'}).split('\n');
for (let label of labels) {
    let norm0;
    try {
        norm0 = lib.normalize(label);
    } catch (err) {
        continue;
    }
	try {
		let norm = ens_normalize(label);        
		if (norm != norm0) {
			let [normalize, adraffy] = await Promise.all([explode(norm0), explode(norm)]);
			diffs.push({label, normalize, adraffy});
		}
	} catch (err) {
		errors.push({label, normalize: await explode(norm0), adraffy: err.message});
	}
}

writeFileSync(local_file('output/ens-nameprep.json'), JSON.stringify({errors, diffs}));