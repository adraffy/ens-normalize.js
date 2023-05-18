import {writeFileSync} from 'node:fs';
import DISALLOWED from '../rules/chars-disallow.js';
import {append_table} from './utils.js';

let lines = [];

lines.push(`# Disallowed Characters`);

// TODO: figure out how to reveal some of these comments
append_table(lines, [...new Set(DISALLOWED)]); 

writeFileSync(new URL('./disallowed.md', import.meta.url), lines.join('\n'));
