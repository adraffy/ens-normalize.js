import {terser} from 'rollup-plugin-terser';
import {nodeResolve} from '@rollup/plugin-node-resolve';

const TERSER = terser({
	compress: {
		toplevel: true,
		passes: 2, 
		dead_code: true
	}
});

const NODE = nodeResolve();

export default [
	{
		input: './index.js',
		output: [
			{
				file: './dist/index.js',
				format: 'es',
			},
			{
				file: './dist/index.min.js',
				format: 'es',
				plugins: [TERSER]
			}
		]
	},
	{
		input: './src/only-norm.js',
		output: {
			file: './dist/only-norm.min.js',
			format: 'es',
			plugins: [TERSER]
		}
	},
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