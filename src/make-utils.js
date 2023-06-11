import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export function compute_sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

export function compute_spec_hash(file) {
	return compute_sha256(readFileSync(file));
}