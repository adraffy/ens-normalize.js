import {run_tests} from '@adraffy/ensip-norm';

let files = [
	'../dist/index.js',
	'../dist/index.min.js',
	'../dist/index-xnf.js',
	'../dist/index-xnf.min.js'
];

for (let file of files) {
	let {ens_normalize} = await import(file);
	let errors = run_tests(ens_normalize);
	if (errors.length) {		
		console.log(errors);
		console.log(`Errors: ${errors.length}`);
		console.log(`File: ${file}`);
		console.exit(1);
	}
	console.log(`PASS ${file}`);

}
