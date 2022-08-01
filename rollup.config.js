import {terser} from 'rollup-plugin-terser';

const T = terser({
	compress: {
		toplevel: true,
		passes: 2, 
		dead_code: true
	}
});

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
				plugins: [T]
			}
		]
	},
	{
		input: './src/only-norm.js',
		output: {
			file: './dist/ens-normalize.min.js',
			format: 'es',
			plugins: [T]
		}
	}
];
