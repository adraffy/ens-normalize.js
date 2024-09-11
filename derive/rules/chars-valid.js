export default [

	// enable ascii
	// https://discuss.ens.domains/t/ens-name-normalization/8652/237
	// https://discuss.ens.domains/t/ens-name-normalization/8652/381
	// 20230815: both suggested as natural-language identifiers
	// https://www.unicode.org/reports/tr31/#Table_Optional_Start
	// 20240910: unicode 16.0.0 made these valid
	0x24, // ($) DOLLAR SIGN
	0x5F, // (_) LOW LINE

	// other candidates
	// https://discuss.ens.domains/t/ens-name-normalization/8652/47
	// https://discuss.ens.domains/t/ens-name-normalization/8652/239

];