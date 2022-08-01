import {terser} from 'rollup-plugin-terser';
import {nodeResolve} from '@rollup/plugin-node-resolve';

const plugins = [nodeResolve()];

const T = terser({
	compress: {
		toplevel: true,
		passes: 2, 
		dead_code: true
	}
});

export default [
	{
		input: './src/dns.js',
		plugins,
		output: {
			file: './dist/dns.min.js',
			format: 'es',
			plugins: [T]
		}
	},
	{
		input: './src/parts.js',
		plugins,
		output: {
			file: './dist/parts.min.js',
			format: 'es',
			plugins: [T]
		}
	},
	{
		input: './src/all.js',
		plugins,
		output: {
			file: './dist/all.min.js',
			format: 'es',
			plugins: [T]
		}
	}
];
