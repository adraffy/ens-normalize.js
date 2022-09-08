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

function replace(map) {
	map = Object.fromEntries(Object.entries(map).map(([src, dst]) => [
		new URL(src, import.meta.url).pathname,
		new URL(dst, import.meta.url).pathname
	]));
	return {
		resolveId(importee, importer) {
			try {
				let dst = map[new URL(importee, 'file://' + importer).pathname];
				if (dst) return dst;
			} catch (err) {
			}
			return null;
		}
	};
}

const NATIVE_NF = replace({'./src/nf.js': './src/nf-native.js'});

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
				plugins: [TERSER],
			},
		],
	},
	{
		input: './index.js',
		plugins: [NATIVE_NF],
		output: [
			{
				file: './dist/index-xnf.js',
				format: 'es',
			},
			{
				file: './dist/index-xnf.min.js',
				format: 'es',
				plugins: [TERSER],
			},
		],
	},
	/*{
		input: './src/only-norm.js',
		output: {
			file: './dist/only-norm.min.js',
			format: 'es',
			plugins: [TERSER],
		},
	},
	{
		input: './src/only-norm.js',
		plugins: [NATIVE_NF],
		output: {
			file: './dist/only-norm-xnf.min.js',
			format: 'es',
			plugins: [TERSER],
		},
	},
	*/
	{
		input: './src/dns.js',
		plugins: [NODE],
		output: {
			file: './dist/dns.min.js',
			format: 'es',
			plugins: [TERSER],
		},
	},
	{
		input: './src/parts.js',
		plugins: [NODE],
		output: {
			file: './dist/parts.min.js',
			format: 'es',
			plugins: [TERSER],
		},
	},
	{
		input: './src/nf.js',
		output: {
			file: './dist/nf.min.js',
			format: 'es',
			plugins: [TERSER],
		},
	},
	{
		input: './src/all.js',
		plugins: [NODE],
		output: {
			file: './dist/all.min.js',
			format: 'es',
			plugins: [TERSER],
		},
	},
];