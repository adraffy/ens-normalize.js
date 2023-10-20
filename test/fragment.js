import {ensNormalize, ensNormalizeFragment} from '../src/lib.js';

// examples where fragment (2nd argument) 
// would error with ensNormalize()
test('1234--abcd', '34--A'); // error: invalid label extension
test('e\u{303}', '\u{303}'); // error: illegal placement: leading combining mark
test('oooooooooooo', 'OΟО'); // error: illegal mixture: Latin + Greek "ο" {3BF}
test('__a-b-c___', 'a_b_c'); // error: underscore allowed only at start

function name_contains_fragment(name, frag) {
	// convert the name to NFD because:
	//   è = E8 => 65 300
	// note that:
	//   "è".includes("e") => false
	//   "è".includes("◌̀") => false
	//   name_contains_fragment("è", "e") => true
	//   name_contains_fragment("è", "◌̀") => true
	// if instead, you want exact codepoint matching: 
	//   use ensNormalizeFragment() without the second argument
	try {
		// suggestion: name should be cached if testing many fragments
		return ensNormalizeFragment(name, true).includes(ensNormalizeFragment(frag, true));
	} catch (ignored) {
	}
}

function test(name, frag) {
	// check frag fails normalize
	let error;
	try {
		ensNormalize(frag);
	} catch (err) {		
		error = err.message;
	}
	if (!error) throw new Error(`expected frag shouldn't normalize: ${frag}`);
	// check containment
	let contains = name_contains_fragment(name, frag); 
	console.log({name, frag, contains, error});
}
