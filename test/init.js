// * 10ms | decompress (base64 => arithmetic => compact data)
// * 30ms | expand groups
// *  1ms | expand wholes
// * 15ms | compute confusable complements
// *  6ms | expand emoji trie 
// * 50ms | compute nfd() of union (10ms init + 40ms compute)
//
// what is init() doing:
// - builds large Set() and Map() structures
// - integer sorts
// note: this could be made much faster with an interval set
// however i prefer to the simplicity of Set() at the moment

const N = 10;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
	let {isCombiningMark} = await import(`../src/lib.js?${i}`); // cheat import cache
	isCombiningMark(0);
}
let t_avg = (performance.now() - t0) / N;

console.log(`init() Speed: ${t_avg.toFixed(0)}ms [${N}x]`);

// 20230905: 285ms
// added delayed init()
// 20230913: 215ms 
// remove sort on V, keep as separate P and Q
// concat and Array_from instead of spreads
// 20230921: 150ms
// build P and Q from parts instead of flattened constructor
