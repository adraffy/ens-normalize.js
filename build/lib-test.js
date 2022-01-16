import {decode_payload, read_member_set, read_mapped_table} from './decoder.js';


let r = decode_payload('');
const a = read_member_set(r);
const b = read_mapped_table(r);
