export default [

	// disallowed by idna
	// default-text presentation emoji that look like punctuation
	// https://discuss.ens.domains/t/ens-name-normalization/8652/10
	// https://discuss.ens.domains/t/ens-name-normalization/8652/408
	// https://discuss.ens.domains/t/ens-name-normalization/8652/417
	// can be recreated using the following:
	//   2753 (❓) BLACK QUESTION MARK ORNAMENT
	//   2757 (❗) HEAVY EXCLAMATION MARK SYMBOL
	'203C FE0F', // (‼️) double exclamation mark   // ❗+❗
	'2049 FE0F', // (⁉️) exclamation question mark // ❗+❓
	// 20220923: changed to mapping
	// 20221005: changed back to disallow

];