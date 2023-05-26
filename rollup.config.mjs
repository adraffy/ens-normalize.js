import terser from '@rollup/plugin-terser';
import nodeResolve from '@rollup/plugin-node-resolve';

const TERSER = terser({
	compress: {
		toplevel: true,
		passes: 2, 
		dead_code: true
	}
});

const NODE = nodeResolve();

const NATIVE_NF = replace({'./src/nf.js': './src/nf-native.js'});

export default [
	{
		input: './src/lib.js',
		output: [
			{
				file: './dist/index.mjs',
				format: 'es',
			},
			{
				file: './dist/index.min.js',
				format: 'es',
				plugins: [TERSER],
			},
			// 20230126: CommonJS support, suggested by Ricmoo
			{
				file: './dist/index.cjs',
				format: 'cjs',
			},
		],
	},
	{
		input: './src/lib.js',
		plugins: [NATIVE_NF],
		output: [
			{
				file: './dist/index-xnf.mjs',
				format: 'es',
			},
			{
				file: './dist/index-xnf.min.js',
				format: 'es',
				plugins: [TERSER],
			},
			// 20230127: CommonJS support, suggested by Ricmoo
			{
				file: './dist/index-xnf.cjs',
				format: 'cjs',
			},
		],
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
		output: [
			{
				file: './dist/all.js',
				format: 'es',
			},
			{
				file: './dist/all.min.js',
				format: 'es',
				plugins: [TERSER],
			}
		],
	},
];

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
