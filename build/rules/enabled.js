export default [
	// allow underscore
	// https://discuss.ens.domains/t/ens-name-normalization/8652/26
	{ty: 'valid', src: '5F'}, // _

	// allow capital currencies
	{ty: 'valid', src: '24'}, // issue: $ -> 💲 already exists
	//{ty: 'valid', src: 'A2'}, // issue: ¢ vs looks like little-c
	{ty: 'valid', src: 'A3'}, // £ vs ₤
	{ty: 'valid', src: 'A5'},   // ¥
	{ty: 'valid', src: '20AC'}, // €
	{ty: 'valid', src: '20BF'}, // ₿
];