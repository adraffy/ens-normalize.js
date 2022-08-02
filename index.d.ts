export function ens_normalize(name: string, pretty?: boolean): string;

interface StopToken {
	type: 'stop';
}
interface DisallowedToken {
	type: 'disallowed';
	cp: number;
}
interface IgnoredToken {
	type: 'ignored';
	cp: number;
}
interface AllowedToken {
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
	tokens: TextToken[]; 
}
type TextToken = DisallowedToken | IgnoredToken | ValidToken | MappedToken;
type Token = TextToken | EmojiToken | NFCToken | StopToken;
export function ens_tokenize(name: string): Token[];