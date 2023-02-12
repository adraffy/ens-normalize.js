import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export function compute_spec_hash(file) {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}