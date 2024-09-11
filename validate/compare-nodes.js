import {UnicodeSpec} from '../derive/unicode-logic.js';
import {print_section, parse_version, version_ordinal} from '../derive/utils.js';
import {execSync} from 'node:child_process';

function wrap_function(fn) {
	return `(${fn})()`;
}
function local_nvm(version) {
	return `~/.nvm/versions/node/v${version}/bin/node`;
}

// eval code in external node, get result as JSON
function run(node, code) {
	return JSON.parse(execSync(`${node} -e "console.log(JSON.stringify(${code}))"`));
}

// `nvm install X`
const OLD_NODES = [
	local_nvm('11.15.0'),  // U11.0
	local_nvm('12.1.0'),   // U12.1
	local_nvm('12.22.12'), // U13.0
	local_nvm('16.20.2'),  // U14.0 (lts)
	local_nvm('18.13.0'),  // U14.0 
	local_nvm('18.20.2'),  // U15.1 (lts)
].map(node => {
	try {
		let version = run(node, `process.versions`);
		return {node, version};
	} catch (err) {
		console.log(err);
		throw new Error(`Missing node: ${node}`);
	}
});

// require that the current node is using the appropriate version of unicode
const UNICODE = UnicodeSpec.from_release('15.1');
if (version_ordinal(parse_version(process.versions.unicode)) !== version_ordinal(UNICODE.unicode_version)) {
	console.log('Expected:', UNICODE.unicode_version.version);
	console.log('Process:', process.versions.unicode);
	throw new Error('Unicode mismatch');
}

console.log(new Date());
print_section('Available Versions');
console.log(OLD_NODES.map(x => ({node: x.version.node, unicode: x.version.unicode})));

console.log();
print_section('toLowerCase()');
test_string_function(() => {
	return Array(0x110000).fill().flatMap((_, cp) => {
		let s0 = String.fromCodePoint(cp);
		let s = s0.toLowerCase();
		return s0 !== s ? [[cp, s]] : [];
	});
});

console.log();
print_section('toUpperCase()');
test_string_function(() => {
	return Array(0x110000).fill().flatMap((_, cp) => {
		let s0 = String.fromCodePoint(cp);
		let s = s0.toUpperCase();
		return s0 !== s ? [[cp, s]] : [];
	});
});

// fn should be pure so it can be "stringified"
function test_string_function(fn) {	
	let expect = new Map(fn()); // run directly
	for (let {node, version} of OLD_NODES) {
		let mapped = new Map(run(node, wrap_function(fn))); // run externally
		let diff = new Map();
		for (let [cp, cps0] of expect) {
			let cps1 = mapped.get(cp);
			if (cps0 !== cps1) {
				diff.set(cp, [cp, cps0, cps1]);
			}
		}
		for (let [cp, cps1] of mapped) {
			let cps0 = expect.get(cp);
			if (cps0 !== cps1) {
				diff.set(cp, [cp, cps0, cps1]);
			}		
		}
		//diff = [...diff.values()];
		console.log(`${version.unicode}: ${diff.size}`);
	}
}

// 2024-09-11T05:57:03.431Z
// ==== Available Versions ====
// [
//   { node: '11.15.0', unicode: '11.0' },
//   { node: '12.1.0', unicode: '12.1' },
//   { node: '12.22.12', unicode: '13.0' },
//   { node: '16.20.2', unicode: '14.0' },
//   { node: '18.13.0', unicode: '15.0' },
//   { node: '18.20.2', unicode: '15.1' }
// ]

// ==== toLowerCase() ====
// 11.0: 50
// 12.1: 43
// 13.0: 40
// 14.0: 0
// 15.0: 0
// 15.1: 0

// ==== toUpperCase() ====
// 11.0: 50
// 12.1: 43
// 13.0: 40
// 14.0: 0
// 15.0: 0
// 15.1: 0
