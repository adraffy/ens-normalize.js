import terser from '@rollup/plugin-terser';
import alias from '@rollup/plugin-alias';
import {defineConfig} from 'rollup';

const TERSER = terser({
	compress: {
		toplevel: true,
		passes: 2, 
		dead_code: true
	}
});

const NATIVE_NF = alias({entries: {'./nf.js': './src/nf-native.js'}});
		
export default defineConfig([
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
			{
				file: './dist/index-xnf.cjs',
				format: 'cjs',
			},
		],
	},
	// these are for /test/
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
]);
