import {readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

let args = process.argv.slice(2);
if (!args.length) {
	throw new Error(`expected args`);
}

let file = new URL('../package.json', import.meta.url);
let json = JSON.parse(readFileSync(file));

function set_package_type(type) {
	json.type = type;
	json.scripts.prepublishOnly = type ? 'exit 1' : undefined;
	console.log(`*** Package Type: ${type ?? '<unset>'} ***`);
	writeFileSync(file, JSON.stringify(json, null, '\t'));
}

set_package_type();
try {
	spawnSync('npm', args, {stdio: 'inherit'});
} finally {
	set_package_type('module');
}