import {UNICODE} from '../unicode-version.js';

console.log(UNICODE.allowed_identifiers().length);

console.log(Object.entries(UNICODE.identifier_types()).map(([name, cps]) => [name, cps.length]));