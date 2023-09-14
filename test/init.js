// what is init() doing:
// * 10ms | decompress (base64 => arithmetic => compact data)
// * 90ms | expand groups
// *  1ms | expand wholes
// * 15ms | compute confusable complements
// *  6ms | expand emoji trie 
// * 50ms | compute nfd() of union (10ms init + 40ms compute)
//
// builds large Set() and Map() structures
// integer sorts

const N = 10;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
	let {is_combining_mark} = await import(`../src/lib.js?${i}`); // cheat import cache
	is_combining_mark(0);
}
let t_avg = (performance.now() - t0) / N;

console.log(`init() Speed: ${t_avg.toFixed(0)}ms [${N}x]`);

// 20230905: 285ms
// added delayed init()
// 20230913: 215ms 
// remove sort on V, keep as separate P and Q
// concat and Array_from instead of spreads
