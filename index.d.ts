export function ens_normalize(name: string, ignore_disallowed?: boolean, check_bidi?: boolean): string;

export function nfc(code_points: number[]): number[];
export function nfd(code_points: number[]): number[];

export function is_disallowed(code_point: number): boolean;
export function is_ignored(code_point: number): boolean;
export function get_mapped(code_point: number): undefined|number[];

export const VERSION: string;
export const UNICODE: string;