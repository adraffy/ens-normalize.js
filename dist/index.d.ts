interface DisallowedToken {
	type: 'disallowed';
	cp: number;
}
interface IgnoredToken {
	type: 'ignored';
	cp: number;
}
interface ValidToken {
	type: 'valid';
	cps: number[];
}
interface IsolatedToken {
	type: 'isolated';
	cp: number;
}
interface MappedToken {
	type: 'mapped';	
	cp: number;
	cps: number[];
}
type TextToken = DisallowedToken | IgnoredToken | ValidToken | IsolatedToken | MappedToken;
interface EmojiToken {
	type: 'emoji';
	input: number[];
	emoji: number[];
	cps: number[];
}
interface NFCToken {
	type: 'nfc';
	input: number[];
	cps: number[];
	tokens: TextToken[]; 
}
interface StopToken {
	type: 'stop';
}
type Token = TextToken | EmojiToken | NFCToken | StopToken;

export function ens_normalize(name: string): string;
export function ens_beautify(name: string): string;

export function ens_tokenize(name: string): Token[];

export function ens_normalize_fragment(frag: string): string;
export function ens_normalize_post_check(norm: string): string;
export function ens_emoji(): number[][];

export function nfd(cps: number[]): number[];
export function nfc(cps: number[]): number[];