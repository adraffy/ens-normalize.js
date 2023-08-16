export function ens_idna_rules(unicode) {
	return unicode.derive_idna_rules({
		// because 2008 makes emoji invalid
		// question: does anyone use 2008?
		version: 2003, 
		
		// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
		use_STD3: true, 
		
		// because 200C and 200D were allowed (deviations)
		// this is effectively "Nontransitional Processing" with a better name
		// https://unicode.org/reports/tr46/#Deviations
		// 20220123: this is also the WHATWG URL recommendation
		// https://url.spec.whatwg.org/#idna
		valid_deviations: true 
	});
}