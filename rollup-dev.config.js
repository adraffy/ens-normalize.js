import {nodeResolve} from '@rollup/plugin-node-resolve';
import BUILDS, {TERSER} from './rollup.config.js';

const NODE = nodeResolve();

export default [
	...BUILDS, 
	{
		input: './src/dns.js',
		plugins: [NODE],
		output: {
			file: './dist/dns.min.js',
			format: 'es',
			plugins: [TERSER]
		}
	},
	{
		input: './src/parts.js',
		plugins: [NODE],
		output: {
			file: './dist/parts.min.js',
			format: 'es',
			plugins: [TERSER]
		}
	},
	{
		input: './src/all.js',
		plugins: [NODE],
		output: {
			file: './dist/all.min.js',
			format: 'es',
			plugins: [TERSER]
		}
	}
];
