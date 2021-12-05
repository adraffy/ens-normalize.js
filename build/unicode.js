import fetch from 'node-fetch';
import {writeFile, copyFile, mkdir} from 'fs/promises';
import {join} from 'path';
import {createReadStream} from 'fs';
import {createInterface} from 'readline/promises';

const major = 14;
const minor = 0;
const patch = 0;

function url_for_spec(name) {
	return `https://www.unicode.org/Public/${major}.${minor}.${patch}/${name}`;
}
function url_for_idna(name) {
	return `https://www.unicode.org/Public/idna/${major}.${minor}.${patch}/${name}`;
}
function url_for_emoji(name) {
	return `https://unicode.org/Public/emoji/${major}.${minor}/${name}`;
}

let urls = [
	url_for_idna('IdnaMappingTable.txt'),
	url_for_idna('IdnaTestV2.txt'),

	url_for_spec('ucd/extracted/DerivedGeneralCategory.txt'),
	url_for_spec('ucd/extracted/DerivedCombiningClass.txt'),
	url_for_spec('ucd/extracted/DerivedJoiningType.txt'),
	
	url_for_emoji('emoji-sequences.txt'),
	url_for_emoji('emoji-test.txt'),
	url_for_emoji('emoji-zwj-sequences.txt'),
];

let base_dir = new URL('.', import.meta.url).pathname;
let downloaded_dir = join(base_dir, 'unicode-raw');
let parsed_dir = join(base_dir, 'unicode-json');

await main();

async function main() {
	if (process.argv.length < 3) {
		throw new Error('expected mode');
	}
	let [_0, _1, mode, ...argv] = process.argv;
	switch (mode) {
		case 'version': {
			console.log({major, minor, patch});
			return;
		}
		case 'download': return download(argv);
		case 'parse': return parse(argv);
		default: throw new Error(`unknown mode: ${mode}`);
	}
}

async function download(argv) {
	await mkdir(downloaded_dir, {recursive: true});
	console.log(`Directory: ${downloaded_dir}`);	
	// write a version file
	await writeFile(join(downloaded_dir, 'version.json'), JSON.stringify({major, minor, patch, date: new Date()}));
	// download the unicode shit
	await Promise.all(urls.map(async url => {
		try {
			let name = url.split('/').pop();
			let file = join(downloaded_dir, name);
			let res = await fetch(url);
			if (res.status != 200) throw new Error(`HTTP error ${res.status}`);
			let buf = await res.arrayBuffer();
			await writeFile(file, Buffer.from(buf));
			console.log(`Downloaded: ${url} => ${file}`);
		} catch (err) {
			console.log(`Download "${url}" failed: ${err.message}`);
		}
	}));
}

function get_bucket(obj, key) {
	let bucket = obj[key];
	if (!bucket) bucket = obj[key] = [];
	return bucket;
}

async function parse_semicolon_file(path, impl) {
	let scope = {
		root: {},
		...impl,
		get_bucket(key) {
			return get_bucket(root, key);
		} 
	};
	let {root, row, comment} = scope;
	let rl = createInterface({input: createReadStream(path)});
	for await (let line0 of rl) {
		let [data, rest] = line0.split('#', 2).map(s => s?.trim());
		if (data) {
			row?.call(scope, data.split(';').map(s => s.trim()));
		} else if (rest) {
			comment?.call(scope, rest);
		}
	}
	return root;
}


async function write_simple_file(name, impl) {
	try {
		let root = await parse_semicolon_file(join(downloaded_dir, `${name}.txt`), impl);
		await writeFile(join(parsed_dir, `${name}.json`), JSON.stringify(root));
		console.log(`Wrote: ${name}`);
	} catch (cause) {
		console.error(cause);
		throw new Error(`error during ${name}`, {cause});
	}
}

function emoji_from_codes(s) {
	return String.fromCharCode(...s.split(/\s+/).map(x => parseInt(x, 16)));
}

async function parse(argv) {
	await mkdir(parsed_dir, {recursive: true});
	console.log(`Directory: ${parsed_dir}`);
	
	await write_simple_file('IdnaMappingTable', {
		row([src, type, dst]) {
			if (!src) throw new Error('wtf src');
			let bucket = this.get_bucket(type);
			if (type.includes('mapped')) {
				if (!dst) throw new Error('wtf dst');
				bucket.push([src, dst]);
			} else {
				bucket.push(src); 
			}
		}
	});

	await write_simple_file('DerivedCombiningClass', {
		row([src, cls]) {
			if (!cls) throw new Error('wtf class');
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file('DerivedGeneralCategory', {
		row([src, cls]) {
			if (!cls) throw new Error('wtf class');
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file('DerivedJoiningType', {
		row([src, cls]) {
			if (!cls) throw new Error('wtf class');
			this.get_bucket(cls).push(src);
		}
	});

	await write_simple_file('emoji-zwj-sequences', {
		root: [],
		row([codes, _, desc]) {
			this.root.push({codes, desc, emoji: emoji_from_codes(codes)});
		}
	});

	// tests

	await write_simple_file('emoji-test', {
		row([codes, type]) {
			if (!type) throw new Error('wtf type');
			this.get_bucket(type).push({codes, emoji: emoji_from_codes(codes)});
		}
	});

	await write_simple_file('IdnaTestV2', {
		test: 'COMPAT',
		comment(s) {
			let match = s.match(/^([A-Z ]*) TESTS$/);
			if (match) {
				this.test = match[1].trim();
			}
		},
		row([src, toUnicode, status]) {
			let {test} = this;
			if (!test) throw new Error('wtf test');
			status = status.split(/[\[\],]/).map(x => x.trim()).filter(x => x);
			this.get_bucket(this.test).push([src, toUnicode, status]);
		}
	});

	// make a copy of the version
	await copyFile(join(downloaded_dir, 'version.json'), join(parsed_dir, 'version.json'));

}