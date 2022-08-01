export function ens_normalize(name: string): string;

interface BaseToken {
	type: string;
}
interface DisallowedToken extends BaseToken {
	type: 'invalid' | 'disallowed';
	cp: number;
}
interface AllowedToken extends BaseToken {
	type: string;
	cps: number[];
}
interface ValidToken extends AllowedToken {
	type: 'valid';
}
interface MappedToken extends AllowedToken {
	type: 'mapped';
	cp: number;
}
interface EmojiToken extends AllowedToken {
	type: 'emoji';
	emoji: number[];
}
interface NFCToken extends AllowedToken {
	type: 'nfc';
	input: number[];
	tokens: Token[];
}
type Token = DisallowedToken | ValidToken | MappedToken | EmojiToken | NFCToken;
export function ens_tokenize(name: string): Token[];