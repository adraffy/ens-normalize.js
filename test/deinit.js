import {is_combining_mark, ens_deinit} from '../src/lib.js';

// `node --expose-gc deinit.js`

for (let i = 0; i < 1000; i++) {
	let t = performance.now();
	is_combining_mark(); // init()
	ens_deinit();
	t = performance.now() - t;
	global.gc();
	global.gc();
	global.gc();
	console.log(t.toFixed(0), process.memoryUsage().heapUsed);
}
