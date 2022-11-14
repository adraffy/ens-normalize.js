import {ens_normalize, ens_normalize_fragment, nfd} from '../src/lib.js';

// naive implementation
function name_contains_fragment(name, frag) {
	// convert the name to NFD because:
	//   è = E8 => 65 300
	// note that:
	//   "è".includes("e") => false
	//   "è".includes("◌̀") => false
	//   name_contains_fragment("è", "e") => true
	//   name_contains_fragment("è", "◌̀") => true
	// if instead, you want exact codepoint matching: 
	//   use ens_normalize_fragment() without the nfd argument (which defaults to nfc)
	try {
		return ens_normalize_fragment(name, nfd).includes(ens_normalize_fragment(frag, nfd));
	} catch (ignored) {
	}
}

// examples                  // these would error with ens_normalize()
test('1234--a', '34--A');    // "invalid label extension"
test('e\u{303}', '\u{303}'); // "leading combining mark"

function test(name, frag) {
	// check that name is normalizes
	try {
		ens_normalize(name);
	} catch (err) {
		throw new Error(`expected name should normalize: ${name}`);
	}
	// check that frag isn't normalized
	ok: {
		try {
			ens_normalize(frag);
		} catch (err) {		
			break ok;
		}
		throw new Error(`expected frag shouldn't normalize: ${frag}`);
	}
	// check for containment
	let contains = name_contains_fragment(name, frag); 
	if (!contains) {
		throw new Error(`expected containment: ${name} ${frag}`)
	}
	console.log({name, frag, contains});
}
