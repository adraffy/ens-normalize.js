function decode_arithmetic(bytes) {
	let pos = 0;
	function u16() { return (bytes[pos++] << 8) | bytes[pos++]; }
	
	// decode the frequency table
	let symbol_count = u16();
	let total = 1;
	let acc = [0, 1]; // first symbol has frequency 1
	for (let i = 1; i < symbol_count; i++) {
		acc.push(total += u16());
	}

	// skip the sized-payload that the last 3 symbols index into
	let skip = u16();
	let pos_payload = pos;
	pos += skip;

	let read_width = 0;
	let read_buffer = 0; 
	function read_bit() {
		if (read_width == 0) {
			// this will read beyond end of buffer
			// but (undefined|0) => zero pad
			read_buffer = (read_buffer << 8) | bytes[pos++];
			read_width = 8;
		}
		return (read_buffer >> --read_width) & 1;
	}

	const N = 31;
	const FULL = 2**N;
	const HALF = FULL >>> 1;
	const QRTR = HALF >> 1;
	const MASK = FULL - 1;

	// fill register
	let register = 0;
	for (let i = 0; i < N; i++) register = (register << 1) | read_bit();

	let symbols = [];
	let low = 0;
	let range = FULL; // treat like a float
	while (true) {
		let value = Math.floor((((register - low + 1) * total) - 1) / range);
		let start = 0;
		let end = symbol_count;
		while (end - start > 1) { // binary search
			let mid = (start + end) >>> 1;
			if (value < acc[mid]) {
				end = mid;
			} else {
				start = mid;
			}
		}
		if (start == 0) break; // first symbol is end mark
		symbols.push(start);
		let a = low + Math.floor(range * acc[start]   / total);
		let b = low + Math.floor(range * acc[start+1] / total) - 1;
		while (((a ^ b) & HALF) == 0) {
			register = (register << 1) & MASK | read_bit();
			a = (a << 1) & MASK;
			b = (b << 1) & MASK | 1;
		}
		while (a & ~b & QRTR) {
			register = (register & HALF) | ((register << 1) & (MASK >>> 1)) | read_bit();
			a = (a << 1) ^ HALF;
			b = ((b ^ HALF) << 1) | HALF | 1;
		}
		low = a;
		range = 1 + b - a;
	}
	let offset = symbol_count - 4;
	return symbols.map(x => { // index into payload
		switch (x - offset) {
			case 3: return offset + 0x10100 + ((bytes[pos_payload++] << 16) | (bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 2: return offset + 0x100 + ((bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 1: return offset + bytes[pos_payload++];
			default: return x - 1;
		}
	});
}	

// returns an iterator which returns the next symbol
function read_payload(v) {
	let pos = 0;
	return () => v[pos++];
}
function read_compressed_payload(s) {
	return read_payload(decode_arithmetic(unsafe_atob(s)));
}

// unsafe in the sense:
// expected well-formed Base64 w/o padding 
function unsafe_atob(s) {
	let lookup = [];
	[...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].forEach((c, i) => lookup[c.charCodeAt(0)] = i);
	let n = s.length;
	let ret = new Uint8Array((6 * n) >> 3);
	for (let i = 0, pos = 0, width = 0, carry = 0; i < n; i++) {
		carry = (carry << 6) | lookup[s.charCodeAt(i)];
		width += 6;
		if (width >= 8) {
			ret[pos++] = (carry >> (width -= 8));
		}
	}
	return ret;
}

// eg. [0,1,2,3...] => [0,-1,1,-2,...]
function signed(i) { 
	return (i & 1) ? (~i >> 1) : (i >> 1);
}

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// [123][5] => [0 3] [1 1] [0 0]
function read_sorted(next, prev = 0) {
	let ret = [];
	while (true) {
		let x = next();
		let n = next();
		if (!n) break;
		prev += x;
		for (let i = 0; i < n; i++) {
			ret.push(prev + i);
		}
		prev += n + 1;
	}
	return ret;
}

function read_sorted_arrays(next) {
	return read_array_while(() => { 
		let v = read_sorted(next);
		if (v.length) return v;
	});
}

// returns map of x => ys
function read_mapped(next) {
	let ret = [];
	while (true) {
		let w = next();
		if (w == 0) break;
		ret.push(read_linear_table(w, next));
	}
	while (true) {
		let w = next() - 1;
		if (w < 0) break;
		ret.push(read_replacement_table(w, next));
	}
	return ret.flat();
}

// read until next is falsy
// return array of read values
function read_array_while(next) {
	let v = [];
	while (true) {
		let x = next(v.length);
		if (!x) break;
		v.push(x);
	}
	return v;
}

// read w columns of length n
// return as n rows of length w
function read_transposed(n, w, next) {
	let m = Array(n).fill().map(() => []);
	for (let i = 0; i < w; i++) {
		read_deltas(n, next).forEach((x, j) => m[j].push(x));
	}
	return m;
}
 
// returns [[x, ys], [x+dx, ys+dy], [x+2*dx, ys+2*dy], ...]
// where dx/dy = steps, n = run size, w = length of y
function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let vN = read_array_while(next);
	let m = read_transposed(vN.length, 1+w, next);
	return m.flatMap((v, i) => {
		let [x, ...ys] = v;
		return Array(vN[i]).fill().map((_, j) => {
			let j_dy = j * dy;
			return [x + j * dx, ys.map(y => y + j_dy)];
		});
	});
}

// return [[x, ys...], ...]
// where w = length of y
function read_replacement_table(w, next) { 
	let n = 1 + next();
	let m = read_transposed(n, 1+w, next);
	return m.map(v => [v[0], v.slice(1)]);
}

// created 2022-11-25T21:26:41.707Z
var r$1 = read_compressed_payload('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');
const FENCED = new Map([[8217,"apostrophe"],[8260,"fraction slash"],[12539,"middle dot"]]);

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function quote_cp(cp) {
	return `{${hex_cp(cp)}}`; // raffy convention: like "\u{X}" w/o the "\u"
}

/*
export function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}
*/
function explode_cp(s) { // this is about 2x faster
	let cps = [];
	for (let pos = 0, len = s.length; pos < len; ) {
		let cp = s.codePointAt(pos);
		pos += cp < 0x10000 ? 1 : 2;
		cps.push(cp);
	}
	return cps;
}

function str_from_cps(cps) {
	const chunk = 4096;
	let len = cps.length;
	if (len < chunk) return String.fromCodePoint(...cps);
	let buf = [];
	for (let i = 0; i < len; ) {
		buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
	}
	return buf.join('');
}

function compare_arrays(a, b) {
	let {length: n} = a;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

function random_choice(v, rng = Math.random) {
	return v[rng() * v.length|0];
}

function random_sample(v, n, rng = Math.random) {
	v = v.slice(); // make copy
	if (v.length > n) {
		for (let i = 0; i < n; i++) { // shuffle prefix n
			let temp = v[i]; 
			let j = Math.floor(i + rng() * (v.length - i));
			v[i] = v[j];
			v[j] = temp;
		}
		v = v.slice(0, n); // truncate
	}
	return v;
}

function run_tests(fn, tests) {
	let errors = [];
	for (let test of tests) {
		let {name, norm, error} = test;
		if (typeof norm !== 'string') norm = name;
		try {
			let result = fn(name);
			if (error) {	
				errors.push({type: 'expected error', result, ...test});
			} else if (result != norm) {
				errors.push({type: 'wrong norm', result, ...test});
			}
		} catch (err) {
			if (!error) {
				errors.push({type: 'unexpected error', result: err.message, ...test});
			}
		}
	}
	return errors;
}

// created 2022-11-25T21:26:41.822Z
var r = read_compressed_payload('AEUDTAHBCFQATQDRADAAcgAgADQAFAAsABQAHwAOACQADQARAAoAFwAHABIACAAPAAUACwAFAAwABAAQAAMABwAEAAoABQAIAAIACgABAAQAFAALAAIACwABAAIAAQAHAAMAAwAEAAsADAAMAAwACgANAA0AAwAKAAkABAAdAAYAZwDSAdsDJgC0CkMB8xhZAqfoC190UGcThgBurwf7PT09Pb09AjgJum8OjDllxHYUKXAPxzq6tABAxgK8ysUvWAgMPT09PT09PSs6LT2HcgWXWwFLoSMEEEl5RFVMKvO0XQ8ExDdJMnIgsj26PTQyy8FfEQ8AY8IPAGcEbwRwBHEEcgRzBHQEdQR2BHcEeAR6BHsEfAR+BIAEgfndBQoBYgULAWIFDAFiBNcE2ATZBRAFEQUvBdALFAsVDPcNBw13DYcOMA4xDjMB4BllHI0B2grbAMDpHLkQ7QHVAPRNQQFnGRUEg0yEB2uaJF8AJpIBpob5AERSMAKNoAXqaQLUBMCzEiACnwRZEkkVsS7tANAsBG0RuAQLEPABv9HICTUBXigPZwRBApMDOwAamhtaABqEAY8KvKx3LQ4ArAB8UhwEBAVSagD8AEFZADkBIadVj2UMUgx5Il4ANQC9AxIB1BlbEPMAs30CGxlXAhwZKQIECBc6EbsCoxngzv7UzRQA8M0BawL6ZwkN7wABAD33OQRcsgLJCjMCjqUChtw/km+NAsXPAoP2BT84PwURAK0RAvptb6cApQS/OMMey5HJS84UdxpxTPkCogVFITaTOwERAK5pAvkNBOVyA7q3BKlOJSALAgUIBRcEdASpBXqzABXFSWZOawLCOqw//AolCZdvv3dSBkEQGyelEPcMMwG1ATsN7UvYBPEGOwTJH30ZGQ/NlZwIpS3dDO0m4y6hgFoj9SqDBe1L9DzdC01RaA9ZC2UJ4zpjgU4DIQENIosK3Q05CG0Q8wrJaw3lEUUHOQPVSZoApQcBCxEdNRW1JhBirAsJOXcG+xr2C48mrxMpevwF0xohBk0BKRr/AM8u54WwWjFcHE9fBgMLJSPHFKhQIA0lQLd4SBobBxUlqQKRQ3BKh1E2HpMh9jw9DWYuE1F8B/U8BRlPC4E8nkarRQ4R0j6NPUgiSUwsBDV/LC8niwnPD4UMuXxyAVkJIQmxDHETMREXN8UIOQcZLZckJxUIIUaVYJoE958D8xPRAwsFPwlBBxMDtRwtEy4VKQUNgSTXAvM21S6zAo9WgAEXBcsPJR/fEFBH4A7pCJsCZQODJesALRUhABcimwhDYwBfj9hTBS7LCMdqbCN0A2cU52ERcweRDlcHpxwzFb8c4XDIXguGCCijrwlbAXUJmQFfBOMICTVbjKAgQWdTi1gYmyBhQT9d/AIxDGUVn0S9h3gCiw9rEhsBNQFzBzkNAQJ3Ee0RaxCVCOuGBDW1M/g6JQRPIYMgEQonA09szgsnJvkM+GkBoxJiAww0PXfuZ6tgtiQX/QcZMsVBYCHxC5JPzQycGsEYQlQuGeQHvwPzGvMn6kFXBf8DowMTOk0z7gS9C2kIiwk/AEkOoxcH1xhqCnGM0AExiwG3mQNXkYMCb48GNwcLAGcLhwV55QAdAqcIowAFAM8DVwA5Aq0HnQAZAIVBAT0DJy8BIeUCjwOTCDHLAZUvAfMpBBvDDBUA9zduSgLDsQKAamaiBd1YAo4CSTUBTSUEBU5HUQOvceEA2wBLBhPfRwEVq0rLGuNDAd9vKwDHAPsABTUHBUEBzQHzbQC3AV8LMQmis7UBTekpAIMAFWsB1wKJAN0ANQB/8QFTAE0FWfkF0wJPSQERMRgrV2EBuwMfATMBDQB5BsuNpckHHwRtB9MCEBsV4QLvLge1AQMi3xPNQsUCvd5VoWACZIECYkJbTa9bNyACofcCaJgCZgkCn4Q4GwsCZjsCZiYEbgR/A38TA36SOQY5dxc5gjojIwJsHQIyNjgKAm3HAm2u74ozZ0UrAWcA3gDhAEoFB5gMjQD+C8IADbUCdy8CdqI/AnlLQwJ4uh1c20WuRtcCfD8CesgCfQkCfPAFWQUgSABIfWMkAoFtAoAAAoAFAn+uSVhKWxUXSswC0QEC0MxLJwOITwOH5kTFkTIC8qFdAwMDrkvOTC0lA89NTE2vAos/AorYwRsHHUNnBbcCjjcCjlxAl4ECjtkCjlx4UbRTNQpS1FSFApP7ApMMAOkAHFUeVa9V0AYsGymVhjLheGZFOzkCl58C77JYIagAWSUClo8ClnycAKlZrFoJgU0AOwKWtQKWTlxEXNECmcsCmWRcyl0HGQKcmznCOp0CnBYCn5sCnriKAB0PMSoPAp3xAp6SALU9YTRh7wKe0wKgbgGpAp6fHwKeTqVjyGQnJSsCJ68CJn4CoPsCoEwCot0CocQCpi8Cpc4Cp/8AfQKn8mh8aLEAA0lqHGrRAqzjAqyuAq1nAq0CAlcdAlXcArHh1wMfTmyXArK9DQKy6Bds4G1jbUhfAyXNArZcOz9ukAMpRQK4XgK5RxUCuSp3cDZw4QK9GQK72nCWAzIRAr6IcgIDM3ECvhpzInNPAsPLAsMEc4J0SzVFdOADPKcDPJoDPb8CxXwCxkcCxhCJAshpUQLIRALJTwLJLgJknQLd0nh5YXiueSVL0AMYo2cCAmH0GfOVJHsLXpJeuxECz2sCz2wvS1PS8xOfAMatAs9zASnqA04SfksFAtwnAtuKAtJPA1JcA1NfAQEDVYyAiT8AyxbtYEWCHILTgs6DjQLaxwLZ3oQQhEmnPAOGpQAvA2QOhnFZ+QBVAt9lAt64c3cC4i/tFAHzMCcB9JsB8tKHAuvzAulweQLq+QLq5AD5RwG5Au6JAuuclqqXAwLuPwOF4Jh5cOBxoQLzAwBpA44WmZMC9xMDkW4DkocC95gC+dkC+GaaHJqruzebHgOdgwL++gEbADmfHJ+zAwWNA6ZqA6bZANHFAwZqoYiiBQkDDEkCwAA/AwDhQRdTARHzA2sHl2cFAJMtK7evvdsBiZkUfxEEOQH7KQUhDp0JnwCS/SlXxQL3AZ0AtwW5AG8LbUEuFCaNLgFDAYD8AbUmAHUDDgRtACwCFgyhAAAKAj0CagPdA34EkQEgRQUhfAoABQBEABMANhICdwEABdUDa+8KxQIA9wqfJ7+xt+UBkSFBQgHpFH8RNMCJAAQAGwBaAkUChIsABjpTOpSNbQC4Oo860ACNOME63AClAOgAywE6gTo7Ofw5+Tt2iTpbO56JOm85GAFWATMBbAUvNV01njWtNWY1dTW2NcU1gjWRNdI14TWeNa017jX9NbI1wTYCNhE1xjXVNhY2JzXeNe02LjY9Ni41LSE2OjY9Njw2yTcIBJA8VzY4Nt03IDcPNsogN4k3MAoEsDxnNiQ3GTdsOo03IULUQwdC4EMLHA8PCZsobShRVQYA6X8A6bABFCnXAukBowC9BbcAbwNzBL8MDAMMAQgDAAkKCwsLCQoGBAVVBI/DvwDz9b29kaUCb0QtsRTNLt4eGBcSHAMZFhYZEhYEARAEBUEcQRxBHEEcQRxBHEEaQRxBHEFCSTxBPElISUhBNkM2QTYbNklISVmBVIgBFLWZAu0BhQCjBcEAbykBvwGJAaQcEZ0ePCklMAAhMvAIMAL54gC7Bm8EescjzQMpARQpKgDUABavAj626xQAJP0A3etzuf4NNRA7efy2Z9NQrCnC0OSyANz5BBIbJ5IFDR6miIavYS6tprjjmuKebxm5C74Q225X1pkaYYPb6f1DK4k3xMEBb9S2WMjEibTNWhsRJIA+vwNVEiXTE5iXs/wezV66oFLfp9NZGYW+Gk19J2+bCT6Ye2w6LDYdgzKMUabk595eLBCXANz9HUpWbATq9vqXVx9XDg+Pc9Xp4+bsS005SVM/BJBM4687WUuf+Uj9dEi8aDNaPxtpbDxcG1THTImUMZq4UCaaNYpsVqraNyKLJXDYsFZ/5jl7bLRtO88t7P3xZaAxhb5OdPMXqsSkp1WCieG8jXm1U99+blvLlXzPCS+M93VnJCiK+09LfaSaBAVBomyDgJua8dfUzR7ga34IvR2Nvj+A9heJ6lsl1KG4NkI1032Cnff1m1wof2B9oHJK4bi6JkEdSqeNeiuo6QoZZincoc73/TH9SXF8sCE7XyuYyW8WSgbGFCjPV0ihLKhdPs08Tx82fYAkLLc4I2wdl4apY7GU5lHRFzRWJep7Ww3wbeA3qmd59/86P4xuNaqDpygXt6M85glSBHOCGgJDnt+pN9bK7HApMguX6+06RZNjzVmcZJ+wcUrJ9//bpRNxNuKpNl9uFds+S9tdx7LaM5ZkIrPj6nIU9mnbFtVbs9s/uLgl8MVczAwet+iOEzzBlYW7RCMgE6gyNLeq6+1tIx4dpgZnd0DksJS5f+JNDpwwcPNXaaVspq1fbQajOrJgK0ofKtJ1Ne90L6VO4MOl5S886p7u6xo7OLjG8TGL+HU1JXGJgppg4nNbNJ5nlzSpuPYy21JUEcUA94PoFiZfjZue+QnyQ80ekOuZVkxx4g+cvhJfHgNl4hy1/a6+RKcKlar/J29y//EztlbVPHVUeQ1zX86eQVAjR/M3dA9w4W8LfaXp4EgM85wOWasli837PzVMOnsLzR+k3o75/lRPAJSE1xAKQzEi5v10ke+VBvRt1cwQRMd+U5mLCTGVd6XiZtgBG5cDi0w22GKcVNvHiu5LQbZEDVtz0onn7k5+heuKXVsZtSzilkLRAUmjMXEMB3J9YC50XBxPiz53SC+EhnPl9WsKCv92SM/OFFIMJZYfl0WW8tIO3UxYcwdMAj7FSmgrsZ2aAZO03BOhP1bNNZItyXYQFTpC3SG1VuPDqH9GkiCDmE+JwxyIVSO5siDErAOpEXFgjy6PQtOVDj+s6e1r8heWVvmZnTciuf4EiNZzCAd7SOMhXERIOlsHIMG399i9aLTy3m2hRLZjJVDNLS53iGIK11dPqQt0zBDyg6qc7YqkDm2M5Ve6dCWCaCbTXX2rToaIgz6+zh4lYUi/+6nqcFMAkQJKHYLK0wYk5N9szV6xihDbDDFr45lN1K4aCXBq/FitPSud9gLt5ZVn+ZqGX7cwm2z5EGMgfFpIFyhGGuDPmso6TItTMwny+7uPnLCf4W6goFQFV0oQSsc9VfMmVLcLr6ZetDZbaSFTLqnSO/bIPjA3/zAUoqgGFAEQS4IhuMzEp2I3jJzbzkk/IEmyax+rhZTwd6f+CGtwPixu8IvzACquPWPREu9ZvGkUzpRwvRRuaNN6cr0W1wWits9ICdYJ7ltbgMiSL3sTPeufgNcVqMVWFkCPDH4jG2jA0XcVgQj62Cb29v9f/z/+2KbYvIv/zzjpQAPkliaVDzNrW57TZ/ZOyZD0nlfMmAIBIAGAI0D3k/mdN4xr9v85ZbZbbqfH2jGd5hUqNZWwl5SPfoGmfElmazUIeNL1j/mkF7VNAzTq4jNt8JoQ11NQOcmhprXoxSxfRGJ9LDEOAQ+dmxAQH90iti9e2u/MoeuaGcDTHoC+xsmEeWmxEKefQuIzHbpw5Tc5cEocboAD09oipWQhtTO1wivf/O+DRe2rpl/E9wlrzBorjJsOeG1B/XPW4EaJEFdNlECEZga5ZoGRHXgYouGRuVkm8tDESiEyFNo+3s5M5puSdTyUL2llnINVHEt91XUNW4ewdMgJ4boJfEyt/iY5WXqbA+A2Fkt5Z0lutiWhe9nZIyIUjyXDC3UsaG1t+eNx6z4W/OYoTB7A6x+dNSTOi9AInctbESqm5gvOLww7OWXPrmHwVZasrl4eD113pm+JtT7JVOvnCXqdzzdTRHgJ0PiGTFYW5Gvt9R9LD6Lzfs0v/TZZHSmyVNq7viIHE6DBK7Qp07Iz55EM8SYtQvZf/obBniTWi5C2/ovHfw4VndkE5XYdjOhCMRjDeOEfXeN/CwfGduiUIfsoFeUxXeQXba7c7972XNv8w+dTjjUM0QeNAReW+J014dKAD/McQYXT7c0GQPIkn3Ll6R7gGjuiQoZD0TEeEqQpKoZ15g/0OPQI17QiSv9AUROa/V/TQN3dvLArec3RrsYlvBm1b8LWzltdugsC50lNKYLEp2a+ZZYqPejULRlOJh5zj/LVMyTDvwKhMxxwuDkxJ1QpoNI0OTWLom4Z71SNzI9TV1iXJrIu9Wcnd+MCaAw8o1jSXd94YU/1gnkrC9BUEOtQvEIQ7g0i6h+KL2JKk8Ydl7HruvgWMSAmNe+LshGhV4qnWHhO9/RIPQzY1tHRj2VqOyNsDpK0cww+56AdDC4gsWwY0XxoucIWIqs/GcwnWqlaT0KPr8mbK5U94/301i1WLt4YINTVvCFBrFZbIbY8eycOdeJ2teD5IfPLCRg7jjcFTwlMFNl9zdh/o3E/hHPwj7BWg0MU09pPrBLbrCgm54A6H+I6v27+jL5gkjWg/iYdks9jbfVP5y/n0dlgWEMlKasl7JvFZd56LfybW1eeaVO0gxTfXZwD8G4SI116yx7UKVRgui6Ya1YpixqXeNLc8IxtAwCU5IhwQgn+NqHnRaDv61CxKhOq4pOX7M6pkA+Pmpd4j1vn6ACUALoLLc4vpXci8VidLxzm7qFBe7s+quuJs6ETYmnpgS3LwSZxPIltgBDXz8M1k/W2ySNv2f9/NPhxLGK2D21dkHeSGmenRT3Yqcdl0m/h3OYr8V+lXNYGf8aCCpd4bWjE4QIPj7vUKN4Nrfs7ML6Y2OyS830JCnofg/k7lpFpt4SqZc5HGg1HCOrHvOdC8bP6FGDbE/VV0mX4IakzbdS/op+Kt3G24/8QbBV7y86sGSQ/vZzU8FXs7u6jIvwchsEP2BpIhW3G8uWNwa3HmjfH/ZjhhCWvluAcF+nMf14ClKg5hGgtPLJ98ueNAkc5Hs2WZlk2QHvfreCK1CCGO6nMZVSb99VM/ajr8WHTte9JSmkXq/i/U943HEbdzW6Re/S88dKgg8pGOLlAeNiqrcLkUR3/aClFpMXcOUP3rmETcWSfMXZE3TUOi8i+fqRnTYLflVx/Vb/6GJ7eIRZUA6k3RYR3iFSK9c4iDdNwJuZL2FKz/IK5VimcNWEqdXjSoxSgmF0UPlDoUlNrPcM7ftmA8Y9gKiqKEHuWN+AZRIwtVSxye2Kf8rM3lhJ5XcBXU9n4v0Oy1RU2M+4qM8AQPVwse8ErNSob5oFPWxuqZnVzo1qB/IBxkM3EVUKFUUlO3e51259GgNcJbCmlvrdjtoTW7rChm1wyCKzpCTwozUUEOIcWLneRLgMXh+SjGSFkAllzbGS5HK7LlfCMRNRDSvbQPjcXaenNYxCvu2Qyznz6StuxVj66SgI0T8B6/sfHAJYZaZ78thjOSIFumNWLQbeZixDCCC+v0YBtkxiBB3jefHqZ/dFHU+crbj6OvS1x/JDD7vlm7zOVPwpUC01nhxZuY/63E7g');

// https://unicode.org/reports/tr15/

function unpack_cc(packed) {
	return (packed >> 24) & 0xFF;
}
function unpack_cp(packed) {
	return packed & 0xFFFFFF;
}

const SHIFTED_RANK = new Map(read_sorted_arrays(r).flatMap((v, i) => v.map(x => [x, (i+1) << 24]))); // pre-shifted
const EXCLUSIONS = new Set(read_sorted(r));
const DECOMP = new Map();
const RECOMP = new Map();
for (let [cp, cps] of read_mapped(r)) {
	if (!EXCLUSIONS.has(cp) && cps.length == 2) {
		let [a, b] = cps;
		let bucket = RECOMP.get(a);
		if (!bucket) {
			bucket = new Map();
			RECOMP.set(a, bucket);
		}
		bucket.set(b, cp);
	}
	DECOMP.set(cp, cps.reverse()); // stored reversed
}

// algorithmic hangul
// https://www.unicode.org/versions/Unicode15.0.0/ch03.pdf (page 144)
const S0 = 0xAC00;
const L0 = 0x1100;
const V0 = 0x1161;
const T0 = 0x11A7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;
const S1 = S0 + S_COUNT;
const L1 = L0 + L_COUNT;
const V1 = V0 + V_COUNT;
const T1 = T0 + T_COUNT;

function is_hangul(cp) {
	return cp >= S0 && cp < S1;
}

function compose_pair(a, b) {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) {
		return S0 + (a - L0) * N_COUNT + (b - V0) * T_COUNT;
	} else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
		return a + (b - T0);
	} else {
		let recomp = RECOMP.get(a);
		if (recomp) {
			recomp = recomp.get(b);
			if (recomp) {
				return recomp;
			}
		}
		return -1;
	}
}

function decomposed(cps) {
	let ret = [];
	let buf = [];
	let check_order = false;
	function add(cp) {
		let cc = SHIFTED_RANK.get(cp);
		if (cc) {
			check_order = true;
			cp |= cc;
		}
		ret.push(cp);
	}
	for (let cp of cps) {
		while (true) {
			if (cp < 0x80) {
				ret.push(cp);
			} else if (is_hangul(cp)) {
				let s_index = cp - S0;
				let l_index = s_index / N_COUNT | 0;
				let v_index = (s_index % N_COUNT) / T_COUNT | 0;
				let t_index = s_index % T_COUNT;
				add(L0 + l_index);
				add(V0 + v_index);
				if (t_index > 0) add(T0 + t_index);
			} else {
				let mapped = DECOMP.get(cp);
				if (mapped) {
					buf.push(...mapped);
				} else {
					add(cp);
				}
			}
			if (!buf.length) break;
			cp = buf.pop();
		}
	}
	if (check_order && ret.length > 1) {
		let prev_cc = unpack_cc(ret[0]);
		for (let i = 1; i < ret.length; i++) {
			let cc = unpack_cc(ret[i]);
			if (cc == 0 || prev_cc <= cc) {
				prev_cc = cc;
				continue;
			}
			let j = i-1;
			while (true) {
				let tmp = ret[j+1];
				ret[j+1] = ret[j];
				ret[j] = tmp;
				if (!j) break;
				prev_cc = unpack_cc(ret[--j]);
				if (prev_cc <= cc) break;
			}
			prev_cc = unpack_cc(ret[i]);
		}
	}
	return ret;
}

function composed_from_decomposed(v) {
	let ret = [];
	let stack = [];
	let prev_cp = -1;
	let prev_cc = 0;
	for (let packed of v) {
		let cc = unpack_cc(packed);
		let cp = unpack_cp(packed);
		if (prev_cp == -1) {
			if (cc == 0) {
				prev_cp = cp;
			} else {
				ret.push(cp);
			}
		} else if (prev_cc > 0 && prev_cc >= cc) {
			if (cc == 0) {
				ret.push(prev_cp, ...stack);
				stack.length = 0;
				prev_cp = cp;
			} else {
				stack.push(cp);
			}
			prev_cc = cc;
		} else {
			let composed = compose_pair(prev_cp, cp);
			if (composed >= 0) {
				prev_cp = composed;
			} else if (prev_cc == 0 && cc == 0) {
				ret.push(prev_cp);
				prev_cp = cp;
			} else {
				stack.push(cp);
				prev_cc = cc;
			}
		}
	}
	if (prev_cp >= 0) {
		ret.push(prev_cp, ...stack);	
	}
	return ret;
}

function nfd(cps) {
	return decomposed(cps).map(unpack_cp);
}

function nfc(cps) {
	return composed_from_decomposed(decomposed(cps));
}

const STOP = 0x2E;
const FE0F = 0xFE0F;
const STOP_CH = '.';
const UNIQUE_PH = 1;

function read_set() {
	return new Set(read_sorted(r$1));
}
const MAPPED = new Map(read_mapped(r$1)); 
const IGNORED = read_set(); // ignored characters are not valid, so just read raw codepoints
/*
const FENCED = new Map(read_array_while(() => {
	let cp = r();
	if (cp) return [cp, read_str(r())];
}));
*/
const CM = read_set();
const ESCAPE = read_set(); // characters that should not be printed
const NFC_CHECK = read_set();
const CHUNKS = read_sorted_arrays(r$1);
function read_chunked() {
	return new Set([read_sorted(r$1).map(i => CHUNKS[i]), read_sorted(r$1)].flat(2));
}
const UNRESTRICTED = r$1();
const GROUPS = read_array_while(i => {
	let N = read_array_while(r$1).map(x => x+0x60);
	if (N.length) {
		let R = i >= UNRESTRICTED; // first arent restricted
		N[0] -= 32; // capitalize
		N = str_from_cps(N);
		if (R) N=`Restricted[${N}]`;
		let P = read_chunked(); // primary
		let Q = read_chunked(); // secondary
		let V = [...P, ...Q].sort((a, b) => a-b); // derive: sorted valid
		let M = r$1()-1; // combining mark
		// code currently isn't needed
		/*if (M < 0) { // whitelisted
			M = new Map(read_array_while(() => {
				let i = r();
				if (i) return [V[i-1], read_array_while(() => {
					let v = read_array_while(r);
					if (v.length) return v.map(x => x-1);
				})];
			}));
		}*/
		return {N, P, M, R, V: new Set(V)};
	}
});

const WHOLE_VALID = read_set();
const WHOLE_MAP = new Map();
[...WHOLE_VALID, ...read_set()].sort((a, b) => a-b).map((cp, i, v) => {
	let d = r$1(); 
	let w = v[i] = d ? v[i-d] : {V: [], M: new Map()};
	w.V.push(cp);
	if (!WHOLE_VALID.has(cp)) {
		WHOLE_MAP.set(cp, w); 
	}
});
for (let {V, M} of new Set(WHOLE_MAP.values())) {
	let recs = [];
	for (let cp of V) {
		let gs = GROUPS.filter(g => g.V.has(cp));
		let rec = recs.find(({G}) => gs.some(g => G.has(g)));
		if (!rec) {
			rec = {G: new Set(), V: []};
			recs.push(rec);
		}
		rec.V.push(cp);
		gs.forEach(g => rec.G.add(g));
	}	
	let union = recs.flatMap(({G}) => [...G]);
	for (let {G, V} of recs) {
		let complement = new Set(union.filter(g => !G.has(g)));
		for (let cp of V) {
			M.set(cp, complement);
		}
	}
}
let valid_union = [...new Set(GROUPS.flatMap(g => [...g.V]))];
for (let cp of valid_union) {
	if (!WHOLE_MAP.has(cp) && GROUPS.filter(g => g.V.has(cp)).length == 1) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}

const VALID = new Set([...valid_union, ...nfd(valid_union)]);

const EMOJI_SORTED = read_sorted(r$1);
//const EMOJI_SOLO = new Set(read_sorted(r).map(i => EMOJI_SORTED[i]));
const EMOJI_ROOT = read_emoji_trie([]);
function read_emoji_trie(cps) {
	let B = read_array_while(() => {
		let keys = read_sorted(r$1).map(i => EMOJI_SORTED[i]);
		if (keys.length) return read_emoji_trie(keys);
	}).sort((a, b) => b.Q.size - a.Q.size); // sort by likelihood
	let temp = r$1();
	let V = temp % 3; // valid (0 = false, 1 = true, 2 = weird)
	temp = (temp / 3)|0;
	let F = temp & 1; // allow FE0F
	temp >>= 1;
	let S = temp & 1; // save
	let C = temp & 2; // check
	return {B, V, F, S, C, Q: new Set(cps)};
}

// free tagging system
class Emoji extends Array {
	get is_emoji() { return true; }
}

// create a safe to print string 
// invisibles are escaped
// leading cm uses placeholder
function safe_str_from_cps(cps, quoter = quote_cp) {
	//if (Number.isInteger(cps)) cps = [cps];
	//if (!Array.isArray(cps)) throw new TypeError(`expected codepoints`);
	let buf = [];
	if (is_combining_mark(cps[0])) buf.push('◌');
	let prev = 0;
	let n = cps.length;
	for (let i = 0; i < n; i++) {
		let cp = cps[i];
		if (should_escape(cp)) {
			buf.push(str_from_cps(cps.slice(prev, i)));
			buf.push(quoter(cp));
			prev = i + 1;
		}
	}
	buf.push(str_from_cps(cps.slice(prev, n)));
	return buf.join('');
}

// if escaped: {HEX}
//       else: "x" {HEX}
function quoted_cp(cp) {
	return (should_escape(cp) ? '' : `"${safe_str_from_cps([cp])}" `) + quote_cp(cp);
}

function check_label_extension(cps) {
	const HYPHEN = 0x2D;
	if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
		throw new Error('invalid label extension');
	}
}
function check_leading_combining_mark(cps) {
	if (CM.has(cps[0])) throw new Error('leading combining mark');
}
function check_leading_underscore(cps) {
	const UNDERSCORE = 0x5F;
	for (let i = cps.lastIndexOf(UNDERSCORE); i > 0; ) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error('underscore allowed only at start');
		}
	}
}
// check that a fenced cp is not leading, trailing, or touching another fenced cp
function check_fenced(cps) {
	let cp = cps[0];
	let name = FENCED.get(cp);
	if (name) throw new Error(`leading ${name}`);
	let last = -1;
	for (let i = 1; i < cps.length; i++) {
		cp = cps[i];
		let match = FENCED.get(cp);
		if (match) {
			if (last == i) throw new Error(`adjacent ${name} + ${match}`);
			last = i + 1;
			name = match;
		}
	}
	if (last == cps.length) throw new Error(`trailing ${name}`);
}

function is_combining_mark(cp) {
	return CM.has(cp);
}

function should_escape(cp) {
	return ESCAPE.has(cp);
}

function ens_normalize_fragment(frag, nf = nfc) {
	return frag.split(STOP_CH).map(label => str_from_cps(process(explode_cp(label), nf).flatMap(x => x.is_emoji ? filter_fe0f(x) : x))).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(ens_split(name));
}

function ens_beautify(name) {
	let split = ens_split(name, true);
	// this is experimental
	for (let {type, output, error} of split) {
		if (!error && type !== 'Greek') { // ξ => Ξ if not greek
			let prev = 0;
			while (true) {
				let next = output.indexOf(0x3BE, prev);
				if (next < 0) break;
				output[next] = 0x39E; 
				prev = next + 1;
			}
		}
	}
	return flatten(split);
}

function ens_split(name, preserve_emoji) {
	let offset = 0;
	// https://unicode.org/reports/tr46/#Validity_Criteria 4.1 Rule 4
	// "The label must not contain a U+002E ( . ) FULL STOP."
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint, not substring!
		};
		offset += input.length + 1; // + stop
		let norm;
		try {
			let tokens = info.tokens = process(input, nfc); // if we parse, we get [norm and mapped]
			let token_count = tokens.length;
			let type;
			if (!token_count) { // the label was effectively empty (could of had ignored characters)
				norm = [];
				type = 'None'; // use this instead of "Common"
			} else {
				let chars = tokens[0];
				let emoji = token_count > 1 || chars.is_emoji;
				if (!emoji && chars.every(cp => cp < 0x80)) { // special case for ascii
					norm = chars;
					check_leading_underscore(norm);
					check_label_extension(norm); // only needed for ascii
					// cant have fenced
					// cant have cm
					// cant have wholes
					type = 'ASCII';
				} else {
					if (emoji) { // there is at least one emoji
						info.emoji = true; 
						chars = tokens.flatMap(x => x.is_emoji ? [] : x); // all of the nfc tokens concat together
					}
					norm = tokens.flatMap(x => !preserve_emoji && x.is_emoji ? filter_fe0f(x) : x);
					check_leading_underscore(norm);
					if (!chars.length) { // theres no text, just emoji
						type = 'Emoji';
					} else {
						check_leading_combining_mark(norm);
						check_fenced(norm);
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								throw new Error(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`);
							}
						}
						let unique = [...new Set(chars)];
						let [g] = determine_group(unique);
						check_group(g, chars);
						check_whole(g, unique);
						type = g.N;
					}
				}
			}
			info.type = type;
		} catch (err) {
			info.error = err;
		}
		info.output = norm;
		return info;
	});
}


function check_whole(group, unique) {
	let maker;
	let shared = [];
	for (let cp of unique) {
		let whole = WHOLE_MAP.get(cp);
		if (whole === UNIQUE_PH) return; // unique, non-confusable
		if (whole) {
			let set = whole.M.get(cp); // groups which have a character that look-like this character
			maker = maker ? maker.filter(g => set.has(g)) : [...set];
			if (!maker.length) return; // confusable intersection is empty
		} else {
			shared.push(cp); 
		}
	}
	if (maker) {
		// we have 1+ confusable
		// check if any of the remaning groups
		// contain the shared characters too
		for (let g of maker) {
			if (shared.every(cp => g.V.has(cp))) {
				throw new Error(`whole-script confusable: ${group.N}/${g.N}`);
			}
		}
	}
}

// assumption: unique.size > 0
// returns list of matching groups
function determine_group(unique) {
	let groups = GROUPS;
	for (let cp of unique) {
		// note: we need to dodge CM that are whitelisted
		// but that code isn't currently necessary
		let gs = groups.filter(g => g.V.has(cp));
		if (!gs.length) {
			if (groups === GROUPS) {
				// the character was composed of valid parts
				// but it's NFC form is invalid
				throw error_disallowed(cp); // this should be rare
			} else {
				// there is no group that contains all these characters
				// throw using the highest priority group that matched
				// https://www.unicode.org/reports/tr39/#mixed_script_confusables
				throw error_group_member(groups[0], cp);
			}
		}
		groups = gs;
		if (gs.length == 1) break; // there is only one group left
	}
	// there are at least 1 group(s) with all of these characters
	return groups;
}

// throw on first error
function flatten(split) {
	return split.map(({input, error, output}) => {
		if (error) {
			// don't print label again if just a single label
			let msg = error.message;
			throw new Error(split.length == 1 ? msg : `Invalid label "${safe_str_from_cps(input)}": ${msg}`);
		}
		return str_from_cps(output);
	}).join(STOP_CH);
}

function error_group_member(g, cp) {
	let quoted = quoted_cp(cp);
	let gg = GROUPS.find(g => g.P.has(cp));
	if (gg) {
		quoted = `${gg.N} ${quoted}`;
	}
	return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}

function error_disallowed(cp) {
	return new Error(`disallowed character: ${quoted_cp(cp)}`); 
}

// assumption: cps.length > 0
// assumption: cps[0] isn't a CM
function check_group(g, cps) {
	let {V, M} = g;
	/*
	for (let i = 0; i < cps.length; i++) {
		let cp = cps[i];
		if (!V.has(cp)) {
			if (CM.has(cp)) {
				throw new Error(`disallowed combining mark: "${str_from_cps([cps[i-1], cp])}" ${quote_cp(cp)}`);
			} else {
				throw error_group_member(g, cp);
			}
		}
	}
	*/
	for (let cp of cps) {
		if (!V.has(cp)) {
			throw error_group_member(g, cp);
		}
	}
	if (M >= 0) {
		// we know it can't be cm leading
		// we know the previous character isn't an emoji
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) {
			if (CM.has(cps[i])) {
				let j = i + 1;
				while (j < e && CM.has(cps[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: ${g.N} "${str_from_cps(cps.slice(i-1, j))}" (${j-i}/${M})`);
				}
				i = j;
			}
		}
	}
	// *** this code currently isn't needed ***
	/*
	let cm_whitelist = M instanceof Map;
	for (let i = 0, e = cps.length; i < e; ) {
		let cp = cps[i++];
		let seqs = cm_whitelist && M.get(cp);
		if (seqs) { 
			// list of codepoints that can follow
			// if this exists, this will always be 1+
			let j = i;
			while (j < e && CM.has(cps[j])) j++;
			let cms = cps.slice(i, j);
			let match = seqs.find(seq => !compare_arrays(seq, cms));
			if (!match) throw new Error(`disallowed combining mark sequence: "${safe_str_from_cps([cp, ...cms])}"`);
			i = j;
		} else if (!V.has(cp)) {
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			let quoted = quoted_cp(cp);
			for (let cp of cps) {
				let u = UNIQUE.get(cp);
				if (u && u !== g) {
					// if both scripts are restricted this error is confusing
					// because we don't differentiate RestrictedA from RestrictedB 
					if (!u.R) quoted = `${quoted} is ${u.N}`;
					break;
				}
			}
			throw new Error(`disallowed ${g.N} character: ${quoted}`);
			//throw new Error(`disallowed character: ${quoted} (expected ${g.N})`);
			//throw new Error(`${g.N} does not allow: ${quoted}`);
		}
	}
	if (!cm_whitelist) {
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // we know it can't be cm leading
			if (CM.has(cps[i])) {
				let j = i + 1;
				while (j < e && CM.has(cps[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: "${str_from_cps(cps.slice(i-1, j))}" (${j-i}/${M})`);
				}
				i = j;
			}
		}
	}
	*/
}

// given a list of codepoints
// returns a list of lists, where emoji are a fully-qualified (as Array subclass)
// eg. explode_cp("abc💩d") => [[61, 62, 63], Emoji[1F4A9, FE0F], [64]]
function process(input, nf) {
	let ret = [];
	let chars = [];
	input = input.slice().reverse(); // flip so we can pop
	while (input.length) {
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			if (chars.length) {
				ret.push(nf(chars));
				chars = [];
			}
			ret.push(emoji);
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				chars.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					chars.push(...cps);
				} else if (!IGNORED.has(cp)) {
					throw error_disallowed(cp);
				}
			}
		}
	}
	if (chars.length) {
		ret.push(nf(chars));
	}
	return ret;
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
}

// given array of codepoints
// returns the longest valid emoji sequence (or undefined if no match)
// *MUTATES* the supplied array
// allows optional FE0F
// disallows interleaved ignored characters
// fills (optional) eaten array with matched codepoints
function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let saved;
	let stack = [];
	let pos = cps.length;
	if (eaten) eaten.length = 0; // clear input buffer (if needed)
	while (pos) {
		let cp = cps[--pos];
		node = node.B.find(x => x.Q.has(cp));
		if (!node) break;
		if (node.S) { // remember
			saved = cp;
		} else if (node.C) { // check exclusion
			if (cp === saved) break;
		}
		stack.push(cp);
		if (node.F) {
			stack.push(FE0F);
			if (pos > 0 && cps[pos - 1] == FE0F) pos--; // consume optional FE0F
		}
		if (node.V) { // this is a valid emoji (so far)
			emoji = conform_emoji_copy(stack, node);
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	/*
	// *** this code currently isn't needed ***
	if (!emoji) {
		let cp = cps[cps.length-1];
		if (EMOJI_SOLO.has(cp)) {
			if (eaten) eaten.push(cp);
			emoji = Emoji.of(cp);
			cps.pop();
		}
	}
	*/
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = Emoji.from(cps); // copy stack
	if (node.V == 2) copy.splice(1, 1); // delete FE0F at position 1 (see: make.js)
	return copy;
}

// return all supported emoji as fully-qualified emoji 
// ordered by length then lexicographic 
function ens_emoji() {
	// *** this code currently isn't needed ***
	//let ret = [...EMOJI_SOLO].map(x => [x]);
	let ret = [];
	build(EMOJI_ROOT, []);
	return ret.sort(compare_arrays);
	function build(node, cps, saved) {
		if (node.S) { 
			saved = cps[cps.length-1];
		} else if (node.C) { 
			if (saved === cps[cps.length-1]) return;
		}
		if (node.F) cps.push(FE0F);
		if (node.V) ret.push(conform_emoji_copy(cps, node));
		for (let br of node.B) {
			for (let cp of br.Q) {
				build(br, [...cps, cp], saved);
			}
		}
	}
}

// ************************************************************
// tokenizer 

const TY_VALID = 'valid';
const TY_MAPPED = 'mapped';
const TY_IGNORED = 'ignored';
const TY_DISALLOWED = 'disallowed';
const TY_EMOJI = 'emoji';
const TY_NFC = 'nfc';
const TY_STOP = 'stop';

function ens_tokenize(name, {
	nf = true, // collapse unnormalized runs into a single token
} = {}) {
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({type: TY_EMOJI, emoji, input: eaten.slice(), cps: filter_fe0f(emoji)});
		} else {
			let cp = input.pop();
			if (cp == STOP) {
				tokens.push({type: TY_STOP, cp});
			} else if (VALID.has(cp)) {
				tokens.push({type: TY_VALID, cps: [cp]});
			} else if (IGNORED.has(cp)) {
				tokens.push({type: TY_IGNORED, cp});
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					tokens.push({type: TY_MAPPED, cp, cps: cps.slice()});
				} else {
					tokens.push({type: TY_DISALLOWED, cp});
				}
			}
		}
	}
	if (nf) {
		for (let i = 0, start = -1; i < tokens.length; i++) {
			let token = tokens[i];
			if (is_valid_or_mapped(token.type)) {
				if (requires_check(token.cps)) { // normalization might be needed
					let end = i + 1;
					for (let pos = end; pos < tokens.length; pos++) { // find adjacent text
						let {type, cps} = tokens[pos];
						if (is_valid_or_mapped(type)) {
							if (!requires_check(cps)) break;
							end = pos + 1;
						} else if (type !== TY_IGNORED) { // || type !== TY_DISALLOWED) { 
							break;
						}
					}
					if (start < 0) start = i;
					let slice = tokens.slice(start, end);
					let cps0 = slice.flatMap(x => is_valid_or_mapped(x.type) ? x.cps : []); // strip junk tokens
					let cps = nfc(cps0);
					if (compare_arrays(cps, cps0)) { // bundle into an nfc token
						tokens.splice(start, end - start, {
							type: TY_NFC, 
							input: cps0, 
							cps, 
							tokens0: collapse_valid_tokens(slice),
							tokens: ens_tokenize(str_from_cps(cps), {nf: false})
						});
						i = start;
					} else { 
						i = end - 1; // skip to end of slice
					}
					start = -1; // reset
				} else {
					start = i; // remember last
				}
			} else if (token.type !== TY_IGNORED) { // 20221024: is this correct?
				start = -1; // reset
			}
		}
	}
	return collapse_valid_tokens(tokens);
}

function is_valid_or_mapped(type) {
	return type == TY_VALID || type == TY_MAPPED;
}

function requires_check(cps) {
	return cps.some(cp => NFC_CHECK.has(cp));
}

function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type == TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type == TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

function hex_seq(cps) {
	return cps.map(hex_cp).join(' ');
}

function create_arrow_span() {
	let span = document.createElement('span');
	span.classList.add('arrow');
	span.innerHTML = '➔'; // '→'; 
	return span;
}

function span_from_cp(cp, in_emoji) {
	let span = document.createElement('span');
	if (cp == 0x200D) {
		span.classList.add('mod', 'zwj');
		span.innerText = 'ZWJ';
	} else if (cp == 0x200C) {
		span.classList.add('mod', 'zwj');
		span.innerText = 'ZWNJ';
	} else if (cp == 0xFE0F) {
		span.classList.add('mod', 'dropped', 'style');
		span.innerText = 'FE0F';
	} else if (cp == 0x20E3) {
		span.classList.add('mod', 'keycap');
		span.innerText = 'Keycap';
	} else if (cp >= 0xE0021 && cp <= 0xE007E) { // printable ascii tag
		span.classList.add('mod', 'tag');
		span.innerText = String.fromCodePoint(cp - 0xE0000);
	} else if (cp == 0xE007F) { // tag end
		span.classList.add('mod', 'tag', 'end');
		span.innerText = '⌫'; // 🏷️
	} else if (!in_emoji && should_escape(cp)) {
		span.classList.add('code');
		span.innerText = hex_cp(cp);
	} else {
		span.innerText = safe_str_from_cps([cp]);
	}
	return span;
}

// idea
//export function dom_from_token(token) {

function format_tooltip(obj, extra) {
	let lines = Object.entries(obj).map(([k, v]) => `${k}: ${v}`);
	if (Array.isArray(extra)) lines.push(...extra);	
	return lines.join('\n');
}

function isolated_safe(cps) {
	return cps.map(cp => safe_str_from_cps([cp])).join('\u{200B}')
}

// TODO: these options are shit, fix this
function dom_from_tokens(tokens, {
	before = false, 
	///isolate = false,
	tld_class = true,
	components = false, 
	emoji_url = 'https://emojipedia.org/%s',
	extra = () => {},
} = {}) {
	let div = document.createElement('div');
	div.classList.add('tokens');
	if (before) {
		// dont use normalized form unless its simple
		tokens = tokens.flatMap(token => {
			if (token.type === 'nfc' && !token.tokens.every(t => t.type == 'valid')) {
				return token.tokens;
			} else {
				return token;
			}
		});
	}
	div.append(...tokens.map((token, i) => {
		let el;
		switch (token.type) {
			case 'emoji': {
				el = document.createElement(emoji_url ? 'a' : 'span');
				if (emoji_url) el.href = emoji_url.replace('%s', String.fromCodePoint(...token.emoji));
				let cps = before ? token.input : token.cps;
				if (components) {
					el.append(...cps.map(cp => span_from_cp(cp, true)));
				} else {
					el.innerText = String.fromCodePoint(...token.emoji); // use fully-qualified form
				}
				el.title = format_tooltip({
					Type: 'Emoji',
					Hex: hex_seq(cps),
					Beautified: hex_seq(token.emoji),
				}, extra(token.type, cps));
				break;
			}
			case 'nfc': {
				el = document.createElement('div');
				if (before) {
					el.innerText = safe_str_from_cps(token.input);
					el.title = format_tooltip({
						Type: 'NFC (Unnormalized)',
						Hex: hex_seq(token.input),
					}, extra(token.type, token.input));
				} else {	
					let lhs = dom_from_tokens(token.tokens0, {components, emoji_url, extra});					if (token.tokens0.every(x => x.type === 'valid')) { // trival case hack
						lhs.querySelector('.valid').innerHTML = token.input.map(cp => safe_str_from_cps([cp])).join('<span>+</span>');
					}
					lhs.classList.add('before');
					lhs.title = format_tooltip({
						Type: 'NFC (Unnormalized)',
						Hex: hex_seq(token.input),
					}, extra(token.type, token.input));
					let rhs = dom_from_tokens(token.tokens, {components, emoji_url, extra});
					rhs.title = format_tooltip({
						Type: 'NFC (Normalized)',
						Hex: hex_seq(token.cps),
					}, extra(token.type, token.cps));
					el.append(lhs, create_arrow_span(), rhs);
				}
				break;
			}
			case 'valid': {
				el = document.createElement('span');		
				let form = safe_str_from_cps(token.cps);
				if (tld_class && (tokens.length == 1 || (i === tokens.length-1 && tokens[i-1].type === 'stop')) && /[a-z]/.test(form)) { 
					// theres just 1 token/or we're the last token with a stop before us
					el.classList.add(form);
				}
				el.innerText = form;
				el.title = format_tooltip({
					Type: 'Valid',
					Hex: hex_seq(token.cps),
				}, extra(token.type, token.cps));
				break;
			}
			case 'mapped': {
				el = document.createElement('div');
				let span_src = document.createElement('span');
				span_src.classList.add('before');
				span_src.innerText = safe_str_from_cps([token.cp]);	// isolate ? isolated_safe([token.cp]) : 
				span_src.title = format_tooltip({
					Type: 'Mapped (Match)',
					Hex: hex_cp(token.cp),
				}, extra(token.type, [token.cp]));
				el.append(span_src);
				if (!before) {
					let span_dst = document.createElement('span');
					span_dst.innerText = isolated_safe(token.cps); // safe_str_from_cps(token.cps);
					span_dst.title = format_tooltip({
						Type: 'Mapped (Replacement)',
						Hex: hex_seq(token.cps),
					}, extra(token.type, token.cps));
					el.append(create_arrow_span(), span_dst);
				}
				break;
			}
			case 'stop':
			case 'ignored':
			case 'disallowed': {
				el = span_from_cp(token.cp);
				el.title = format_tooltip({
					Type: token.type,
					Hex: hex_cp(token.cp),
				}, extra(token.type, [token.cp]));
				break;
			}
			default: throw new TypeError(`unknown token type: ${token.type}`);
		}
		el.classList.add(token.type);
		return el;
	}));
	return div;
}

function use_default_style() {
	let style = document.createElement('style');
	style.innerText = `
	.tokens {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}
	.tokens > * {
		padding: 2px 4px;
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 5px;
	}
	.tokens a {
		text-decoration: none;
	}
	.tokens a:hover {
		border-color: #00f;
	}
	.tokens .valid {
		background: #cfc;
		border: 2px solid #0a0;
		line-break: anywhere;
	}
	.tokens .valid.eth {
		color: #fff;
		background: #58f;
		border: none;
	}
	.tokens .valid.com {
		color: #fff;
		background: #0a0;
		border: none;
	}
	.tokens .ignored {
		color: #fff;
		background: #aaa;
		font-size: 75%;
		font-family: monospace;
	}
	.tokens .disallowed {
		background: #c00;	
		min-width: 5px;
		min-height: 1em;
		border-radius: 5px;
		color: #fff;
	}
	.tokens .disallowed.code {
		font-size: 75%;
		background: #800;
	}
	.tokens .disallowed.mod {
		border: 2px solid #800;
		font-size: 80%;
	}
	.tokens .disallowed.mod.tag {
		background: #f00;
		color: #000;
	}
	.tokens .mapped {
		display: flex;
		border: 2px solid #66f;
		background: #ccf;
	}
	.tokens .mapped span:first-child {
		margin-bottom: -4px;
		border-bottom: 4px solid #000;
		text-align: center;
		min-width: 0.5rem;
	}
	.tokens .stop {
		font-weight: bold;
		background: linear-gradient(#fff, #ff0);
		padding-bottom: 0;
		border: 1px solid #ccc;
	}
	.tokens .emoji {
		border: 2px solid #0aa;
		background: #cff;
		color: #000;
	}
	.tokens .mod {
		color: #fff;
	}
	.tokens * .mod {
		font-size: 70%;
		padding: 2px;
		border-radius: 3px;
	}
	.tokens .emoji .mod {
		background: #333;
	}
	.tokens .emoji .mod.zwj {
		background: #0aa;
	}
	.tokens .emoji .mod.tag {
		background: #0aa;
	}
	.tokens .emoji .mod.tag.end {
		background: #066;
	}
	.tokens .emoji .mod.dropped {
		background: #aaa;		
	}
	.tokens .arrow {
		color: rgba(0, 0, 0, 0.35);
	}
	.tokens .code {
		font-family: monospace;
	}
	.tokens .nfc {
		display: flex;
		border: 2px solid #c80;
		background: #fd8;
		border-radius: 5px;
		padding: 2px;
	}
	.tokens .nfc .before .valid span {
		color: rgba(0, 0, 0, 0.35);
	}`;
	document.body.append(style);
}

export { compare_arrays, dom_from_tokens, ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, explode_cp, hex_cp, is_combining_mark, nfc, nfd, quote_cp, random_choice, random_sample, run_tests, safe_str_from_cps, should_escape, str_from_cps, use_default_style };
