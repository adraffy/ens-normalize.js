import {ens_normalize, ens_normalize_fragment} from '../index.js';

// naive implementation
function name_contains_fragment(name, frag) {
	try {
		return ens_normalize(name).normalize('NFD').includes(ens_normalize_fragment(frag).normalize('NFD'));
	} catch (ignored) {
	}
}

// examples
test('1234--a', '34--A');    // error: invalid label extension
test('e\u{303}', '\u{303}'); // error: leading combining mark

function test(name, frag) {
	try {
		ens_normalize(name);
	} catch (err) {
		throw new Error(`expected name should normalize: ${name}`);
	}
	ok: {
		try {
			ens_normalize(frag);			
		} catch (err) {		
			break ok;
		}
		throw new Error(`expected frag shouldn't normalize: ${frag}`);
	}
	let contains = name_contains_fragment(name, frag); 
	if (!contains) {
		throw new Error(`expected containment: ${name} ${frag}`)
	}
	console.log({name, frag, contains});
}
