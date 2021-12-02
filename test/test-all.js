// latest compression
await import('./test-compress.js');
console.log('PASS: compress.js');

// minified version
await import('./test-dist.js');
console.log('PASS: dist.js');

// rendered version
await import('./test-known.js');
console.log('PASS: known.js');

// readme
await import('./test-readme.js');
console.log('PASS: readme.js');