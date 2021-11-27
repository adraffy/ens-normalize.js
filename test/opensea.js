import lib_fs from 'fs/promises';
import lib_path from 'path';
import fetch from 'node-fetch';

const CONTRACT = '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85';
const PER_PAGE = 50;

function url_for_ens_page(i) {
	return `https://api.opensea.io/api/v1/assets?order_direction=desc&offset=${i*PER_PAGE}&limit=${PER_PAGE}&asset_contract_addresses=${CONTRACT}`;
}

let out_dir = './opensea-dump/';
try {
	if (process.argv.length < 3) {
		throw new Error('expected mode');
	}
	let [_0, _1, mode, ...argv] = process.argv;
	if (mode === 'download') { // download by page
		await lib_fs.mkdir(out_dir, {recursive: true});
		let page = parseInt(argv.shift()) ?? 0;
		while (true) {
			let res = await fetch(url_for_ens_page(page));
			if (res.status != 200) break;
			let json = await res.json();
			json = json.assets.map(x => ({token: x.token_id, name: x.name, owner: x.owner.address}));
			let out_file = lib_path.join(out_dir, String(page).padStart(10, '0') + '.json');
			await lib_fs.writeFile(out_file, JSON.stringify(json));
			console.log(out_file);
			await new Promise(ful => setTimeout(ful, 5000));
			page++;
		}

	} else if (mode === 'names') { // all names (constains junk)
		let out_file = argv.shift();
		if (!out_file) throw new Error('expected name');
		out_file = lib_path.resolve('.', out_file);
		let names = await join(() => true, x => x.name);
		if (!out_file.endsWith('.json')) out_file += '.json';
		await lib_fs.writeFile(out_file, JSON.stringify(names));
		console.log(`Wrote: ${out_file}`);

	} else if (mode === 'known') { // known label-hash pairs
		let out_file = argv.shift();
		if (!out_file) throw new Error('expected name');
		out_file = lib_path.resolve('.', out_file);
		let out = await join(() => true, ({name, token}) => {
			if (name === 'Unknown ENS name') return;
			let pos = name.lastIndexOf('.eth');
			if (pos == -1) throw new Error('wtf?');
			let label = name.slice(0, pos);
			return {label, hash: BigInt(token).toString(16).padStart(64, '0')};
		});
		if (!out_file.endsWith('.json')) out_file += '.json';
		await lib_fs.writeFile(out_file, JSON.stringify(out));
		console.log(`Wrote: ${out_file}`);

	} else {
		throw new Error('wtf mode');
	}
} catch (err) {
	console.error(err);
	process.exit(1);
}

async function join(file_filter, row_filter) {
	let ret = [];
	for (let name of await lib_fs.readdir(out_dir)) {
		if (!name.endsWith('.json')) continue;
		if (!file_filter(name)) continue;
		let file = lib_path.join(out_dir, name);
		let list = JSON.parse(await lib_fs.readFile(file));
		ret.push(list.map(row_filter).filter(x => x));
	}
	return ret.flat();
}