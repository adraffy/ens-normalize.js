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

// created 2022-12-03T08:45:46.713Z
var r$1 = read_compressed_payload('AEERsAhwDcMBuQJ3APcBMgDgASgAnADSAHMAoQBoANYAaACKAEQAkQA7AHgAOQA8ACsANgAmAGUAHQAuACgAJQAWACwAGQAiAB8ALwAWACoAEgAdAAkAHgAQABkAFgA8ACUALQAtADUAEwApABAAHQAfABEAGAAeABsAFwTLBdwBFxPIN8sF2wC5AK5HAW8ArQkDzQCuhzc3NzcxYwENDw0R8wAFB0cG7DkFXwVgAD0zOQj2vhkGDtDJABYD0AXopWECzQo3Ao6pAobgP5ZvkQLF0wKD+gEn5xEA8rUBSQI1lQpHlwDrAOoKHQAf3MHQFBNFpQQjfwEFAkEYxQ/zEQYx8Q0EiW8NA8UHrwc1ALMAcZnvrZyHAGMGmwMrBvEAIwBDDJsXA6oDykMg1wjDMQO5AxQDAPc1c6sAqYUgAB8ELQPfHgElAMEZ1QUCESBUPwmfCZAmIyJWwUzrg0oAGwAUAB0AFnNcACkAFgBP9h3gPfsDOWDKneY2ChglX1UDYD30ABsAFAAdABZzIGRAnwDD8wAjAEEMzRbDqgMB2sAFYwXqAtCnAsS4AwpUJKRtFHsadUz9AMMVbwLpABM1NJEX0ZkCgYMBEyMAxRVvAukAEzUBUFAtmUwSAy4DBTER33EftQHfSwB5MxJ/AjkWKQMvL8E/cwBB6QH9LQDPDqm9ASNriQC5DQANAwCK21EFI91zHwCoL9kBqQcHBwcHKzUDowBvAQohPvU3fAQgHwCyAc8CKQMA5zMSezr7ULgzqS81UAYBBgIvBWEFYLfABXE7ZUIaQlhJn3ubZmeiABMbA80PLfl/KwSrUwJbWwJ9I7MvAZerrT1jA00fBItpEQDZAwazRzcrAwcxAkFlAHMBaSd5AIslIQCdAVG/AC9xHwG3zQM/NSlLBVsBd2EGbQJtAPlRHwMxCQ0AUUkAswEAZQB7ADO9Bg/79yGVhwcAESkAMQC7I08B2QHjDxM5l4CB8AASABkAPABFAEA7d4HbyBBnEGQJBk0RTHRCFRMCtA+uC+0RHQzZKtPT4AA0sQfzA1sH8wNbA1sH8wfzA1sH8wNbA1sDWwNbHBLwItvIEGcPUAR1BZYFkwTeCIsmURGJBzAI2lQVdCYcTwNNAQQjLUkkO5szEyVKTBRNCwgENkpsr31AA08xs1T9kKoD0zJXOXQJBh55EqgAMg97JDW9ToZ6T3GoClNPtrWHSWpObwLGOrBAAAopCZtvw3dWBkUQHyepEPsMNwG5AT8N8UvcBPUGPwTNH4EZHQ/RlaAIqS3hDPEm5y6lgF4j+SqHBfFL+DzhC1FRbA9dC2kJ5zpngVIDJQERIo8K4Q09CHEQ9wrNbw3pEUkHPQPZSZ4AqQcFCxUdORW5JhRisAsNOXsG/xr6C5MmsxMtewAF1xolBlEBLRsDANMu64W0WjVcIE9jBgcLKSPLFKxQJA0pQLt4TBofBxklrQKVQ3RKi1E6Hpch+jxBDWouF1GAB/k8CRlTC4U8okavRRIR1j6RPUwiTUwwBDmDLDMnjwnTD4kMvXx2AV0JJQm1DHUTNREbN8kIPQcdMZcoJxkIJUaZYJ4E+6MD9xPVAw8FQwlFBxcDuRwxEzIVLQURgSjbAvc22S63ApNWhAEbBc8PKR/jEFRH5A7tCJ8CaQOHJe8AMRUlABsinwhHZwBjj9xTCS7PCMtqcCN4A2sU62URdweVDlsHqxw3FcMc5XDMXg+GDCinswlfAXkJnQFjBOcIDTVfjKQgRWdXi1wYnyBlQUNeAAI1DGkVo0TBh3wCjw9vEh8BOQF3Bz0NBQJ7EfERbxCZCO+GCDW5M/w6KQRTIYcgFQorA1Ns0gsrJv0M/G0BpxJmAxA0QXfyZ69guigYAQcdMslBZCH1C5ZP0QygGsUYRlQyGegHwwP3Gvcn7kFbBgMDpwcXOlEz8gTBC20IjwlDAE0OpxsH2xhuCnWM1AE1jwG7nQNblYcCc5MGOwcPAGsPiwV96QAhAqsIpwAJANMDWwA9ArEHoQAdAIlFAUEDKzMBJekCkwOXCDXPAZkzAfctBB/HDBkA+ztuTgLDtQKAbmamBeFcApICTTkBUSkECVJLVQOzdeUA3wBPBhfjSwEZr07PHudHAeNzLwDLAP8ACTkHCUUB0QH3cQC7AWMLNQmmt7kBUe0tAIcAGW8B2wKNAOEAOQCD9QFXAFEFXf0F1wJTTQEVNRwvW2UBvwMjATcBEQB9Bs+Rqc0LIwRxB9cCEB8V5QLvMge5BQMi4xPRQskCveJZADIaCjwKqwqqYF9kNwo1dj1UABIfrD7LP1IFVTtXO1w7VztcO1c7XDtXO1w7VztcA5vD5sPmCnBfSWHvDKoN2ETMOk0T32BVYDYTzC27FMUV0iVaGUEawCcJJehVDQ8ILddmNAgwNHkXwABDKWyDRWOKHjQKTxzrU5VU/C0fALVLpjOzDbAbGUREBUt18WIuFhIKJgJkhQJiRl9RswFfNyQCofsCaJwCZg0Cn4g4Hw8CZj8CZioEcgSDA38XA36WOQo5exs5hjonJwJsIQIyOjgOAm3LAm2y844DN2tJLwFrAOIA5QBOCQecDJEBAg/GABG5AnczAnamQwJ5T0cCeL4hYN9Fskb3AnxDAnrMAn0NAnz0SARIgWcoAC8ZSVxKXxkbStAC0QUC0NBLKwOIUwOH6kTJkTYC8qVdBwMDskvSTDEpB9NNUE2zAotDAorcxR8LIUdrCbsCjjsCjmBEm4UCjt0CjmB8UbhTOQEOUthUiQKT/wKTEADtACBVIlWzVdQKLB8pmYoy5XhqRT89ApejAu+2WCWsAF0pApaTApaAoACtWbBaDYVRAD8ClrkCllJcSFzVApnPAploXM5dCx0CnJ85xjqhApwaAp+fAp68jgAhEzUuEwKd9QKelgC5QWE4YfMCntcCoHIBrQKeoyMCnlKpY8xkKykvAiezAiaCAqD/AqBQ2wKmMwKl0gKoAwCBAqf2aIBotQAHTWogatUCrOcCrLICrWsCrQYCVyECVeACseXbAx9SbJsCssERArLsG2zkbWdtTGMDJdECtmA/Q26UAylJArhiArlLGQK5LntwOnDlAr0dAy22AzIVAr6McgYDM3UCvh5zJnNTAsPPAsMIc4Z0TzlJdOQDPKsBAzyeAz3DAsWAAsZLAsYUjQLIbVUCyEgCyVMCyTICZKEC3dZ4fWV4snkpS9QDGKdnBgJh+Bn3lSh7D16WXr8VAs9vAs9wM09X1vcXowDKsQLPdwEt7gNOFn5PCQLcKwLbjgLSUwNSYANTYwEFA1WQgI1DBM8a8WRJeQOC0oORAtrLAtnihBSETadAA4apADMDZBKGdV39AFkC32kC3rx3ewLiM+0YAfM0KwH0nwHy1osC6/cC6XR9AwLq/QLq6AD9SwG9Au6NAuuglq6XBwLuQwOF5Jh9cORxpQLzBwBtA44amZcC9xcDkXIDkosC95wC+d0C+GqaIJqvvzubIgOdhwL+/gEfAD2fIAGftwMFkQOmbgOm3QDVyQMGbqGMogkNAwxNASEBIwdxBmW9awkAvwRvwxWPHrcRABt5PQAnAzezA8UMEQONgwFnKyUAjPMAJQDmpwujlQi7BiOnyQYArwUZwwbxJUVGBRaABXA/RkgzQilCvF95GV/EAJbNBToAkFQhm8E7LmA6GbrXDjcYzhiRyf4FXwVgBV8FYAVrBWAFXwVgBV8FYAVfBWAFXwVgTh0I341vCgoKCmxe8TME0QO5BjfDwwDDBK/DAO9IMRa6BU4+cT54QkdCvl99P1/wAFgZM7MAjQbMc8wEpu9GgkUuKwwzHi8+PX5133LB+RnKLHEBc9d2OB8FZwVyycnJwAjXUWMICAgKhF6Fk8YAOz+JAAsW2QbttSsNAIzLEwMJFQDlbSVFLCdSQrlCxElAK18vYD4vQCsJyUUGCkw/Sz6APok+eD55ApFCxFFKQ1/TVldyVRI0AHNcNwNyARN2J1/oO0IjCW+jCmorM0QlLkKzQsQzzAnMBF/RFic2ERARBAcCByp+pd9yQjVSH8mzybQJbcnT1ApoQWcP7RCrGQCTlSVNQi0bsW1BzkAKOz9LPnhCRxwPEiVUT3RjNDVa6bwaCoX1JTNCRxxlEFIRFjtcS0o/DDtLnDQKiSM1Qkcb/RBbKisgODkIDY9p8GYKeWTRYBNgNSt2B0tgIUEKIyZguw4KcxhtVmBVGQkGB2TvYB1gnWCFYLtgU2CZcBYfBr0W3F2xvGILQx6zAcMz1ckKJx0IJAsmAYECdAI3OJ1aiAMBkgrATyIA7Ct0lhLSFQWuTfIBowKPpFcFSGcA/wBFEgg8Hl+CE60ULCfCt08AVxQ8BAAdE781XALaE0ttESMA4FYGfQQSJmIAOQC+AqIvCxZ3syEBYwGOCgQD4fUXBrIGUgbBACXLXbFiEbtpE5ELLUcOwwHDASoKTwRiBjAwMCgmJyk0Gi4OACkUlQBcAnZfmFGdCXYnBQ95TwHbdRfWWSghsbhN8gcZBVRnAP8ARRIIggcADix0Eo8TrUA4Nc+3XhUTAGfEEwBrSm9QKSIjxwA5AL4Coi8tQxbWApgYgwJQw1jQdHqO36WjDv2hFUUb9BLhEg4PIwQBzwlCEJsNGDMUPhMAQwC71gEKAKwA6QCbkjcAHABjG842dH4yFckDGApDS9vpJCYTG4UCfwTJErLxdAA/QTUOrkAu1qkkB8MRABBCLtYZIQB9s+IkD8MiTxzVqXcmAUUqZyQC86AQBFTz7B9tDMQNAghECkYABcgLRQJTDcMIxA1ECsQu1qkyCUQPkxrpBCMOww2YCSMLwxZDAKgQwwwGGKh75AA7cwtDDEQAAq4JxAUj2PUNBQ520gaDAAfDEmMZEsQBCQDyCQAAfBVjDhbTHPx3F8MYQwAuwwLzqMMAAcMAHsMCXSgyhwAC6xVEFcMr86PD0KhDCwKmJ1MAAmMA5+UZw6VjFr/MAPwagwipBRL/eADfw6fDGOMCGsOjk3l6BwOpo4sAEsMOGxMAA5sAbcMOAAvDp0MJGkMDwgipnNIPAwfIqUMGAOGDL75txgNQAAPzABXDAAcDAAnDAGmTABrDAA7DChjDjnEWAwABYwAOcwAuUyYABsMAF8MIKQANUgC6wy4AA8MADqMq8wCyYgAcIwAbwwAB8wqpAAXOCx0V4wAHowBCwwEKAGnDAAuDAB3DAAjDCakABdIAbqcZ3QCZCCkABdIAAAFDAAfjAB2jCCkABqIACYMAGzMAbSMA5sOIAAhjAAhDABTDBABpAwkpAAbSAOOTAAlDC6kOzPtnAAdDAG6kQFAATwAKwwwAA0MACbUDPwAHIwAZgwACE6cDAAojAApDAAoDp/MGwwAJIwADEwAQQwgAFEMAEXMAD5MADfMADcMAGRMOFiMAFUMAbqMWuwHDAMIAE0MAaTMSAOFTAAJDAARaABeDBSMABtgAGMMFJgGDMFoAQU0AtxAHFQx6ADAyeAGsDQhmAnQrFAcFEQ93U3RnMpEnBogcBmo1PgOpCrwHCeAAHgMDC3YBfnpPWhwpA1cCHUYBNAYLe07Fg1qCSAAxADkJAAMBAQBbEuMAg5g0ATMAfu0VGTpOCVIAXw0ACVgBD5LUAIBDBCitAGIA3h0AnXA/J5MA1XO5ANfcAh4Qyn17IyBeJQAR2QGQmLMqW1tVUBpEypEAAQCHJD9IMTPoGZ9XAHoBMSw4KUohFwM4XQT/zfYAU23kAHICeQJHEYI6z3g2Nd0DAg0YGicMHA8As7QBAAAAAgQCAgAZ0QMAKgAAAAIBBgYGBgYGBQUFBQUFBAUGBwgJBAUFBQUEAAACAgAAACIAigCNAJI9AOcAuADZAKFEAL8ArwCqAKUA6wCjANcAoADkAQUBAADEAH4AXwDPANEBAADbAO8AjQCmAS4A5wDcANkLAQkPOtnZ2dm7xeHS1dNINxwBTgFYNEwBVgFlAWQBVwFIUEhKbRIBTxoNEAs6PhMOACYUKy0vMj5AQENDQ0RFFEYGJFdXV1dZWVhZL1pbXVxcI2NnZ2ZoZypsbnZ1eHh4eHh4enp6enp6enp6enp8fH18e2IAQ/IASACZAHcAMQBl+ACNAFYAVgA2AnLvAIoABfj4AGMAkvIAngBOAGEAY///sACEAIQAaABVALAAJAC1AIICPAI/APsA5gD9AP0A5wD+AOgA6ADnAOUALwJ3AVABPwE9AVMBPQE9AT0BOAE3ATcBNwEbAVcXADEQCAEAUx8SHgsdHhYAjgCVAKUAUQBqIAIuAHQAbQCVAw8DITADG0NMLgCOAkoAwwJSAp0AvQKPAo8CjwKPAo8CjwKEAo8CjwKPAo8CjwKPAo4CjgKRApkCkAKPAo8CjQKNAo0CjAJuAc4CkAKWAo8CjwKOGnwQAwFnjgOWA5sCNBwBThU4AtkXEDAZAUg7GVCUAXWnYQFjXAEAAzhLAQEAlDEeIJdyADFoAHEANgCRA5zMk/C2jGINwjMWygIZCaXdfDILBCtiAboA5YaIh4aIhomKioaLjoyGjZCOiI+KkIqRhpKGk4aUkpWGloaXipiGmYaahpuGnIudkJ6Kn4YAiiyoAIsABEMEQARCBEUEQwRJBEYEQQRHBEkESAREBEYESQCrA48A0VkA1wIUAP5iAP4BIQD+APwA/AD9APzcBIwrbcYA/gD8APwA/QD8JACRYgD+AJEBIQD+AJEC9AD+AJHcBIwrbcYkAP9iASEA/gD+APwA/AD9APwA/wD8APwA/QD83ASMK23GJACRYgEhAP4AkQD+AJEC9AD+AJHcBIwrbcYkAksBPgJSAUECU8kDpgL0A6bcBIwrbcYkAJFiASEDpgCRA6YAkQL0A6YAkdwEjCttxiQEOACRBDkAkQ6VOXUoAgA0AJEIRnYLACsBBQDOYgoAXGIABhs6CgCRCkXgAFEKAJEKAJ5uP/0NuIHA9QZyddtEonNOaAVASR3nZTqeLzQfSu5RyxSErHH9LDlMXosApI4X6lD6dcPkJda24nmLx4WMgWI+gX+GfnvSJx8a891BDMagmm8XFRQNuAr8b7evpm0JiNF8zp8X++S6FgAXeVKIFjqVdECyK5EQ2bP1SM5W+gux6ywSiDAuLYRU4J7eGdf/WIU2yfqY8juPprOoWljXvPyZCWeiPhsxjC4TO7AJnYBQcWlFrJVZBvMDkOO/ne6UnYrqhnRpd9FZYILJARrfyuUFPdJFkqMI8U7uRxDtd/Ea0mJjBTbmaQLyGwGxhXoL0/+4Zbww8aRtzBQIrAyNB4i2YmEd+F2nFK27Vj2hrOsi55INi03RZ8sb/ES7qIEyg3xufBVLDdUy1jL0lli4YDJqzCNd5GxpaocUtqzb8+Dj5guUHHwj3Rj8bGNwBADLDwrH2CQqAZXXU6ZpElFSNzZ22yn4ecY/5Ot+nhRiG1WA6vjoGhXjguzCHEO8H/GJ4C5FE15/Q9XpsuHeI7H50C1Q8lIbv3pAaBr8dVseqw0D4Fj2VEe6egfIsSzOrmSfY/qGJwkx5RB+fHzLe2Flw56nq9C8DtjDbQmAC9v4zbUVb/jcDwmD8bZ2QWd9i/hO8GjX+4mncDyDa29dYzQ2q0SsjuJQ3K5ycwm932ejYFL+b6bfOkwdnUR8NevNNgWeoYACRPvY5fXBSrnGI1Qi+SscFwxf7enFMl7Gu/q21a1p4DbllDyHqDJo0vXmTJRTgAAcrWYyivBm97DDB0DBJUHTLFox9ZEkCMPzogatp1P9tsEq4AI/83lWSsatgAVX9AK61vslDvXBorzXecfh7tBW5fucdYF25aiZarERt8Lw1ypnFmGZl3XeyRSeomc01DqnYA63LcdZF/rIDprwghEWtVJErJaUkVxRVqhk4Utxm9oR8GL4KYBrikYekWOhcDkfAxvbL/ziniGTjb/uytYQNVw3DVYxsapVJDSRXW8B2YDZ0DlyiY1ConxzIoXzwKjRrL1Z6uOLKKkcKJlZfb6vCRCWYLd/Op/eMcRejGugPGTwgRttJ7Rn3KK+wKsM1kIFREkvJj6BAhPfKj646byhShiDYlAJ/1HnZ4ivTYyOpjmUdEAjI1yHTDeypaJyEnELBIaY2cetcrOy03rZ3Kb+yBEGdgrrDi4ARiX+YPDdKXgZ3o/EZHSw3RTu80HGv02xpqsqVQBRZ7YrRM9v7PjVetQ5RfhnCABtSnpGO9WPTSy8bIFXX6/HV3o5SqcHEvSo36+RncrEP6R0g9G0ei9GZVSfHdKEE8N2su7ZZZJ4GDLfw0+16v9N4SA1HYZcGS0ctrhcqDsSUHtrdBqkg+AWbfAJaqBUojIhkqyHVd74aZbABpoa1ZMVLBja0rZ/5eh6rrKbws0T956/jAIUDnbWAkfH4QM6fWLaeS7C2PkRcdpy2aOior41xTJj4WEXfsg6bbXmFdiQcZM6ZPHsbcX9yAW881An5t+lKHpUEndNj3+bCDqde7suRWyoXCKocMnq0kc1MUnt4HNYG9nRG9GqPHRLDgBDkET8TWji8aecpF8ST13NS8h4OaZONhwJ7AhzRoIivSSQZhQ2KsSNaMdF4YKPmcpUx8ithEm6k6QqVIhwaHgXiEQ2bPBJL4+UtTgAaaHtF9NktsCbbf2kIcmGhWtmUV2L5GpVhRnh8lOBbydiq9DMTcQ2B9npoUcWJMWcxPpZFvr9Lbgriwd7OYbe6jp4vhMTVPYbtz/NHbV4B5vEv8jTzWqHRRHTL4wGq72GKCj1AiMIfLGM8h49CDhtkdKvIMjqpxCbZdqa9zeCqZEAgbw9qM6iwDm51h8fkBaCGj07aD8N1p+B5T9qnsfbvhBPvs+Jzqsyg0t6DDQCkIFZzKm/6i/fQEKWJuRHKARX1YvoHEE1w8ZNMiJcIF+NIfNRN5zfoykIkbtjI7i7eKd4kvLVnJj6BrQNe1kVOazNMEYFSzBjqDbUg70KZX0byiW2Nm5JpHzURQxWG4zDZFygA5RlQn94OYgKQxU2JluUzrrfwfmGAnyjcXIjIVhVEg0S7FLgWuzEUZ1KnfFOx73kAXcAUCU+zmozUvxlOUANJ/jG2934E0NA6BMxyfiDob65ZuLSRko6ehrD/wHCxUuU9wKqQn6ObcoPyyeq8CCgLn2IzC9DAFXaU2n+3Dke6MmKUQRD1JPoenQDTe/SfhRWqPaVuUMH0hnHqHvot8QvC3jR0Q5ook6hHe/Jgu8fJWBkrIfYJdY/4CeF98Q8453Us0fXr3n9X4v/1s0t79Gd4GrygXdRg8vcOozGWjXhGW1IYL4k0qGaz+WxfyS+DS5HGXMzo8ussx53ZsS/swtJdYppw2wh8C7/DLbT8yeOIUlXFJH+iyR3T3JXwTcE3LVvvmvFtiXSqVbXPTHXxT0LUGthEgeclzyZD+S6p5VPgvrfzkp8q7q2c5WsabU3vyea6/jFWXhqFxYzNY8XZAZu4mtE+JS3pNJwe/ReeEfHdXPO1fZnAGhqVblX7iXrQw8EaXV6NQQ0wBl1rYhqz0mzhFOxtBdd+w1IY5fNI+TZLrUq9JN00NAG8kAkfWVV8gyb00GfL8fubs5/QYiiD8W1hKEl3olxWl8iDu2bSiCxk1j6PnUTKglZCIT01mrE6Z1COlAGJheJON4E2gSd9VNpSnXM4l8srn26dlgTKLEc7KSf/B5Q1NsA9IWFUdxpbxeqQQxCeyqqCQ+qGX3cofBdUQ0cJAJGhkz4NdXVn6f+NdDALiksMcqtyE0Rf//cFNXelihgq03gpew5wel/qinKISG3ZU7KnlNH2w9iElYf6QP/a40Augof/na3VIHiZ1TMXtpkWoNf7yj/+dh1yCNaL8aJT3iTFI4q9699q+3y64nLOVPoYJdUWcSm1tAOxXCo35INECFQQx+wZK/KHME27S7losayn//aAYvRLa9ZxwsXSVQ3p6UxEkNDCX2dtodgUVXJEWHMfuOmR86ggKSm38+ND53zCwSBvHr4LgWGOlmEW8gNG2t7h80RDlTM8CxsLFzIQeScsdATQZXQeGPon0RwMh2eAsheX5R28kI1oYgPc8RghwvxvG5oLnTJMlvYQEdzw4tlwQTI0xH6Jmz2jxZtM0rn4w7NnRblbgn8a8+/6QWytNP7EGDms5f7rkgl1Enmqqc0FxQE5PZe4gAEB375cemwBHJRXjOg1SGrm/f8Dc/BeN7gn78eRVHjgVTW+XWEBJhU7EPlWLZDxnfWdy1PmcJptwmDzi/iqXYViseMugkgyxjaD5Fxl5cxVAfJeh22VhlpGunnsD64U8GDLjtwsJfciGNiiR3PJnrsCkc8zX3SlPH5pbo5uwGYWD8B0Ptsr9ThPBhfTCjQfxFxE6zjpOfvzbT38cEAezj6bVcpMWG7y6RPPhAKEoESiwWOy78I5roxujza7heKo04NFEdVccgXEcBs+2sP+YjI3Dv0nldJndgBsFnH6131a1+coMWuoGbTlOlgJWv0w6oJmBFLRxwMyHl2kJrXtl09s4D5GZGE1o1ZZwn9YI1ASjbjCzTOcJRTuUjnYusgyphEbWw3zLzrEEQbgrg/jophP30VWIk/Dq6u1jp6rDgoibO1RzKvOHxGD7npB8iESeSGgt86Y+CNL0Jf9wMGWYiWyUN6BL4nsC4k95JaeaQyAGY0bOPua08UeKhcB7XIyuStxt9DISFV1ylFLA+/iU1SpFh6Th+CfF2HpK1eI7bVoORtFhBNs0rvuJH4p1/Gi3tiRUNlfz3oThmTKdtqxbkBYWBB7QQ+om22TAr/gfACA9WfzdanvQq4dkZ7hAeo8IhdNEpsS9mtbgSvhzq8KEzaJjD/9yQ7CCCsNzp9WaU9dXHzURc27o0YF6+o1s247Oqd/KRT25kS9rXQv3XHtN4S43Xfs2/G82wlmo1sC+b7erdGEMoK/j9UdymWJp2i7GwKMRWdQuWM2WyWDAjJDOUrxjJB4WD7/tRbV01O7/eWlp/h+/BORCXO/cVWHD/J1bBZhwd9XMGPNq2hY978eONF32Nn3lRtvvnrtqldPkBz34dDdNGQuXxD3WGp8wVReft9nWeGY/g3FJfv5ecmkhxXNexmUL9D0GsrqJwHHLvczB9MEls7jwRUSQ2336PA/lR8wCtHOxdr9nA5Z8MyTG1TRfOrMtj3rkYpSj0uwvqQt/J4AwyctemHVW/z3Pf3EEjIbdFDxGlrQXO9KDYEc52SZSl9ObBVq10xpbJ+YtAt+WopunuOZj5dzC94VgbBFoDRStnbcev1q8VMmNum2dmaPVLFYY+EGn5IspytGVk5vP5+FBoIHMz5VO0kfzxHJJGhWYRcvcRPVvNgUYY0J9lmoKSlIDN58VKe9xfyowKEissCq3c1fwg2wByBnFEoN5JoWugVHFc6cWPb6BcJDqE/jr4TZsl9DZ8dj6SL/UcoUWPHbCnNWx195p3OsaWRtjfzin0EaDKP8UOhl94VixKZv819np/3l5Hsv4LLRlhrdX27bPIh2ItNVsgQtqh0VNApPOB5ZqicAwCzhbJnwZAxkIyGjPIf7FVv6DII4v87n0IJYyFRp64zLbGjVUaB80+fddw5Q4VwPbUVxHxyWchFfk1PLwtf5pb73ufr5Q2YqlZEV/revvY5IWy2ITQbnZjunP8Nd4G7TkcdOq+DnwHIqhCFEX3TPW4BEnb0COvQFpUm602DFqhIfXbGD1fTA1r3yw7tE7Zi49cZ1uDKUAhhBlP21pO7FvX6BIh2EIhMjl9nonmXHWJHrn0lESyKQqGU0JqYtLaIbFfCmiLf2aL6fnNQM2n9mTa9WnWVjkNBSqPSSI/WybeE3kDF/LqfWpe24CmqbTmxeycQhpgdlsejOUJUAM2pR7PeaLRmaA8YGGbaxZyWN06dyUztWqHr77Wfs9Wshow7w0AkyFUuR07AKP+nCA2vMHhQoNJ6rn/6Tf1U8J8IOQCHIeGMNnUCiV/ur6ODjEbQWo4P7XxdRvitaWH5lsp4Gj7+NNfgbfo59VIPmaLJCEp+cLv+kTEkECmFnoEkJw7m62gKaC+ZuZTqyG2JCDENZEZH1s+RMF45PZ6F7qg8nW1yuXszVCJTGLxvzEH3qMsmyQq04K4xVH+kmy13AHOgK5nyRCMLHJJ2FsqDBSJsXCOIWIrOirL5J121/z2tFRkF91VsQaDhLFfhb725kRWrW9wevaF2/c0QmHZ6qI6nr2cEAN8gGbgaobg4qvnMI0gJQXP+bebHULPNBh93DoYK/c0atl1/dCOM+h6IYiDsdK2pZPi+ZG+PuqrpoFffHRXs0oSa8aXpWdOL1GpVAYP54Juh8wB5ZXRhcYHhtnZc1q0XrmI+vJeug9zgsmyEneiaUtATfYNuQJL9d3qpoaVoBtyirMHkZspJkNC/WsgGAScwVNyPh+/Z7XWfp7TVxEeoRD/6KsPN9O+JZm9EsDLZ9HpoqCNcRKQ2kP4Qq15JqY2Nw0uatRwjENUr1nCi+06Gtzgb6p8unYmqsEdJwya9Rm6NtMm2DOB2+RIHEOfjYHNigwH8SwaXDSmkHg7euBoCB13rhP3AwWD1eb1eQJj3chNxJQFdlbN7aJ5D0lV//MMUFZ7QO/ckSEe4IbEZI8AJJI2sxfYZATktAZ5D1hB3Vuyn3gqyXN0Y0+yjlx9dPD21WszVo8h9OUBaCNJ3NAgK6DfD9lVruMn4bY/ztNucOB0DO1xV+J6uLkQ92MJ3PMmjbEKWdtgHLHw1xhjrZuxq3roEUQC7CLYwBy1qPtZr7rJmI1thmFa5OtkBfxyAtrabV76cEYK0rwTIg4q1BRaJLYffyfpV/5zN4ORjuKQ007OqNZiY4SAshdrjCZ4sKZrO0PUMf2MotuBT/yRNoH2IuZVx9QLCFo4Ivuouv1YDk4w9wlANJu4I35Dkiqg5v2nzC/jOzZnSeV4dmCFwEAP2cU5skVb1DSvAFpPJLBXop5cvLDJjnLXD119icN3EhqxdVtSHv3wBDWNC1VrwlQoNpshuzfepk4By7hvcRcMV1lgs2jq5W/yYRuVPDv5IXEA0/Y8rEEWd7odt9R0S+FHjuKEaUmRLzjZM+sKmb7yudjWk9pTJHC+5POEU/opvuHfyWYoG6cVXBXZLwW5523oxqHaGiY/piUZzb/E2nKN1E8oRElPCZhr2C8dKWAsrCNkK4C3Xg2Ku1aAD4fl8AwaDvAD++Wl7QT+me7rvwR945UqU6CA/kTLNmCIarhp4owxWWmPqmyPhtsFUHDy4ROhigqPPsjlPUC3mviUlWtl43qBryytwCK1IoQcTxfy6yFLQvfUoa/YaPQ6JHAKQ0Y6FMQe6ERdBEKecqU6gpDdKToasyIcVq1x5qFd/pWC9pZjM+23tHrSv+FstjDGgD+gfOeG38jBtZ4/iZbxLyKvnGII/73LTnA/R31MYgA4RopMu+xPbH8Xz0NYRfr1Zp9GePd02PpMnXLKXUZXI4WNz22m8zAHc272E74JnvmlAkfz8jfcke8mM8Hef38ws67Bk/ugFJS/rAEweOCDLWfC5o625nwKU8NVUnqXeeSugEDT3kgyCLC4jT/9b15KQCi4RUjC7T3IBFcYvJEvvS4vaP8PLljU1/8uatsftf60eLhuDPjPwoGy+QcY/HcqroNBJSKMPj5xan+zQ112F9fVe3UrDpIrpLMkuoW0AC/LbtZ5gBR6KDsF4pTLDGafDuAX34Eatkw5Aatf6JG1/EHv0NmDa4mR164GJ3KA1b26aDvQtS3ACR7ZuAdIE/3VkUBc3eceVtYoSnPLzhZBF64J/xSXoeG7RFy1MKtb88k0VFhP4mO10tzFwIP+Fg7gzjawKlxz9dwYZGGlRA9KLQqsC+q2EGfJLO0Le9C282r3crkrUa04v7z/XUeCDMo27uA965fKMoCWwhw8XTbN+pTlkmT9bXHgerFs0EmFqu5VSK54el/E4N8lTTGqtBMNTrC7Chm7iXsBlf8CUd/79ZTcAxCwWJuM2rLgb6GGz7giOyBIe56Ttt+JLrJQ+jeqIN7+/cQKov9bRYmcQcAx2FGmGEkNtfRZV0OIccZKFtcj3mRzle/XXoPIs23uhRH9hU4w0qPBH4+bwvPaZCbkgk4IiZl72TbvPORHEHqWpiFq6eP4oYLPZr6ueMifRxPYD5B5xoyk330t17yiy4xWJ0iUz5Rid7cy7GwptPrO6dp0pXb1kemPdhX5z18xW+iCQvxAYsCFvX6h50XkrfiRd73EsJZCVLOV6ip5ayf7UuvpMpNgcN4WshjdbEWsfeXnj+ekwPxBZGQk+76Vg8mrSWWq+7plp20DIqeNSN+cElFgmZ0I+7Vy6eKpL9yJzVVGUVSCbYW1OmAp5rmmo9ANkGi7zhHwfpqO+lqa8tTOXEdN9APaWkqeTyCq2fIw8HOQExq8vVH1IKc/cXvqzd1GnhVD51ynmRPejjZKs4l3lFwgNcbtD4NzqUH7ExDnqcIBQotENhFgorlzjLvKGrplA3bXaA2n5ZHnMNSJqFDmlSfWuK2urtdSuoxT7aNN+lvLT4QxgEVj2chtD5MVn3cMuGeEi5MjkuOrX9fUXNsSfsqn6iOMm9xN/xYWDNJmTghH3LJXgpzpcymZPEGHRfv2YyoIwPH0C8iZXhqEbsdbIN1f04QhNyTRPjl+uBez0Z6ZSqfaekySh1ywq+x421AKp11AJ8xiIlycw9zAKlYX+wEvDN+cGcY4cT/FlMYR88S7uJ11fI6fNA56sdZkpHk2hB5HqemjAz0Tf7w+w+gLEQHmtFuBI98gpO0MwYjkwUv64s3IDhbCGo4ZHVMT0XsZJ/C25M102/Ec0K/TjesegU8MmF1gsj9b8dljQ27Qi56n9ZwuUWQZA19WwjDut1QK/gUlHN0B5bput4gfO+55NplevaEwphusmw73yt8r9SBuCystCtC9K9cDkSTvLW0/uYPgQUShshI4jKKLb2wxhQO2NCeHMW0v+C/9Qq3M/Em+G/Gl4tkqL7B3g8ibUrnPP96OGArAXy3hoEWPkJuxu0O060o1a5YwENToQ9NzP0CGby/IFZyeIQ860YnZStU5pflkHWQfn0DHUxWF9ji8zcwkDFwltH30ObwqZIgQuITCujWFHjtcVQelICtudmnWLlQVvUrcmBq9bqmrjCl1bfMhbGaFR4eB1um1+9onFQ5+tztUynvgQRWaUqUiiDeDRdmJgxeWQ/AWetbrb4hqWhbSbnKQ//hIoLymv+X/1nsdImJT8m9Spd8rBUJY0mRqaB9tmJx1D+IqN3qkmSE+iLyFH2VCiMqB7Jdledhrl3oWtlMbLeYCksDU1xmyZIucuqjqVScgMyIhPM76yYN5tRfJGs1J0DAz1AaV+Sd76sQAMLfeVZwcJkYaea5PF1V6g4TvAm++XlTzaY198fyfw7/mhJAiiqDufodfedqGzYXIFVlwTb2ZhBrEJ4tbdTrzukalwZMMDrBmZABst9wrwuyE5m1CVkYLw4HQYA7w7WUzs327SjXEH0/7I/YJgGEKIiwNlWn9vVvqVTnSAqeYxAiOetA23w0NuJK+bh4Bbg7zsnK0R66MbAQs3hTKSoOm86CWvTjdDsDlA6UMMt2o83TX9Ei/i+d/fw4+vFxVOYxZO4mgep+3aBGu7WoX93Ad4I9e+0Dl7dzUMN8rQtsXkKxSqtxGWrbYlH4UT48YRvHe2ZDOhH+x9L1EyNQloMGVZd4nsn5tvyay3NQWLwtcrjdhhFk0/Bj8Fr+5dr+cTKgqthHeJjzc860MS2r6xFooBeqVim4+/SUDIztkcfQSoQCMzznpUmhYGmeKdNIfElYFFpVyAWs2jBpn5Lo//yI9nFn+Lex6uo7Hr76ipUfVlcifXucHK+vyIf+f4XZbYHK3+8v4URFF2wRh1Sz//OasT9uP94Mtj1bHu6uj828TIiyDh1eYaJxgk4syDoHXcVJWohCeoQ8mM///9lO3xOOj1l1qZoGiflaMGZn0MKZ3lTBjQGem/vxOR47LEKfK2VS7Bxjc1KI+QanGI5NXZqUY9rcGr+SkHWub5nh97JSvq7uilnFy8TLsdL9JAQ+JSveRI8avULkczdhYk61Pvj8n4gbPTHEeHT3fcWDxavxDPG1ZqJIjrp4dANDkhPfLOXlLJ9g8mxDI+NyOwVcJlLIDJPVpaYwh4F44HCZP7yOAGgEudhwFNUVkdq2P0PuRslKrm8MCt6wuDqcefT2Dm3zmrzrym8+2eZY8OuKZeOvD4R8dqDNYYRRfKJt894+eCtyXUImdb6IlWOhrmVPZT5Twh20knlAsESiZWQjYq3st81IuwojvrYyRwOvt+cs/hdQI2m/0C1/OHAMHF7YOa65in1SO7EHqA3HDIaR5rxBm0b6pdYOWdoFE25vXH3zkhdq7+gO0Uz3Eryj1IWTMJueitzOgrbE9jVc7bJE9Yd2qvJWXKQ1082uk/t4iIjh0uLSwQ2/77JDMPBLT4wfzrpCqW4DuZJOobIDZUYh8IPu5icoDWZq1Q58gG8Lg1Mq/+05VlVmTBU4ENFHzBhfgUidpJN5u24UnlPCgM3xzhY9BXuW2yzQhusYt0fFFb3u2yS9UFJt3iGNyKs7OpUFtr81kSiPmgm6ZrnliWk/rZIYm2gRaqZzvtZTSzRky2O5Q0tV0oW3gvEgEv75IOxyU4jJ+rSlLoA2HFOCfGJ2H7Ylc3XR6dnlBpf/5CBfHcj7pajC/klLnj/863bvpY6fa8RqDbL0Vxw/3kWinY0oadxlS4f6E74EsoYVSDYFVCChoqyPP5OlMN7XGUlRI79N5cM+ZqIRRpU+RtMXN6W2wLE0ECnUZ56uezd6FUH5OWJbz+AqtZ6ySrKeb3yTLbMcwaHDPK68GF0VlOTpiU8Xdqkrq/X2/Nn0DJ60zsIe0bOST49GKxSWEHZ94Cs73CuIsehcw/dbDeLDULqtXNCggEYIUDQ9tnmZ6OgUBUZLzWXgzCQlbZznMvqNwQIq9cHEj8maKphRxqk6cTWfABb+fXIvHu83FEC4dUWUEJc0V8Nlen+P9OhEgTxfCx5V3M52LdMssezhLJdW4s4rf2+yB126Bqfbjn3E8B/YANuXRYrQBym9Xl8fuinTZbsjh/t7W//So2ZY2uJ6Jjoa7rgqes+GYzBJshDMH1jdd+McnWHJNlnX2xQO4+Hw7wos3rC3/IoLfdv0lmjvPri3ee8g8nQjzSwPvyojzUw0fHAwCyOI4ovXOYevXxqLy/5lnlXZkSDmiUIE0tdOSHww7A/NfE09aRTsfA+RWZvGqAV9lcHPf0pvw1Dr8+i8dwqdDhGEBNgDOlCfkCLDpXG7hxi2TZjohZlCbGWLYxwh8XVvMBkbF4BMZnR/Vz2Yw0EmWfxnAEnufcWQ7j90GFu46opYDKyjYos1DB7V3udWtl6ugvslWk16mZyspvd1tFcWeFgbIKFnCPpUG7qwtTIJFpXcsCHUSOhgc84iqOhAWJ4gS9T/O41cbR0cIHWpqh5GDMIntcyWSj0ESO9z7M7dqXzeRyB50SVk0q/TGpRHi9vXTf0d4xaisM4lnb+jF6KpQzDiVCIJUuZMyhTvRPOqpPFycvJp4pYS30Li7TcYS+pMOWCfHUQQdMMffNHKKJOp6xI0dJVm/l08PdEljXP3zLPXfymO4D7xDOH58KwhBj8w5Z4PStpaJ03rySrhSRRzfBy+PXzNX9vnsUmriJdI2XZcpAQE4K30nQv3zhBCyhAN2KBnxFZKDdg8TOK7JAK4TlQp6lTpR1st/y/BRdAu6z/yLHX+bq/InHMhL2+8Q2STJFRFdY9yTVE8xN6yIvT2gXabg1MZkhR9bN4WrVRGqGBwIsw+cRK0eer1Les6aV3AoEjik5k2A8CjfQGCDshSABWkaR3rJh6syDa3aM+Qp7+0VNosU/rmSvn/wg8NSFJGA9LNifsAXxCRORfCRYQFtmZdHjpLofDdiIdpLjoboaNPr8glNRnnh11+/+CSPDJYvn7J1NbSWveCMBgR+OxhnC3rl1by84hF8NELyFkvY1PQN1x2VGBi13757kMXX2PUhep/x2KOR4j8X4nWnpr8H78j3/GlxbqDLtNAF6ZwqUAWhC74FFjZH7zk2uKpCwOdw1gmBx0HHzZYSJsSoofk5ygTtMA6HE7eswvl2bbTwH5qFVwFbYTSc+aihySEsduv4/xdxAoTqGwpdKjuPiZHzGUO4Lf53jnTL4XoI0XmupVU3HzRZ4rZDr0M/P/x6OQq5olOJajgiTLFBlYqKC2qJFlzb/0I5lwIRXimNTREnS+cGnyVj30XnzTXd1GSEf9rhAJl40tZenjKQdD9dLVkq1yyZzpwDVwRxsaT5XNonU1VuYqonrIZqC2OSeRWRVd+xMQMjt7UhxguFdq5QEom+pX0B0umxekxlOrNCBFP2FBAeUldK4FM7L6gOq2j+vugRmBuh1LNALesc1XqLSShynag5bucqeEOMJPOYV9qYCNCgepj9f8m6PPJF61yOwDX5+ZP+XYQz7vs39AjOOLG1lPIeSJx3dNQGPoyfY90h+9AMH01K2vccrPsGpwHqtsjibIve1AUPGnLzuipAKOtWSYDWdEUiQAc+GlQNLmR/vGMm2K6JYmatWjvzQHPUX+8x3ayC+A26jS/S0HpQvv76GR12xbKP68yhx1T9f2TTFQsPyjuejnGcVMlEoCmhmOQ2HzWQU9YwktkBREsdjAxSPTQAULRhvDFvwSbLFma7rMuaUZoEXySoz4V8ytsVPi9bTi+P18o9mLbDY6ULoZ+bizTvX1qy7c4KKTF8uGKULmE9yfw5pJ1dlKY+fRmL5IcEsg7P0cmIfKv9xjRXWxDCr5IFjECgy5VLB7xaIzxEaZTyCaROBqYm0XFeM+c//KVcXoIypyXHd/4xFfcLqTloB4zOG9pCHVPrsDkzi22Nx8s18OoVXrFdK4+CL2zut2UETQ8wx1DGd0oy0nOpI');
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

// created 2022-12-03T08:45:46.821Z
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

// note: cps can be iterable
function nfd(cps) {
	return decomposed(cps).map(unpack_cp);
}
function nfc(cps) {
	return composed_from_decomposed(decomposed(cps));
}

//const t0 = performance.now();

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
let union = new Set();
let multi = new Set();
for (let g of GROUPS) {
	for (let cp of g.V) {
		(union.has(cp) ? multi : union).add(cp);
	}
}
for (let cp of union) {
	if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}
/*
// this is too slow, 500ms+
let valid_union = [...new Set(GROUPS.flatMap(g => [...g.V]))];
for (let cp of valid_union) {
	if (!WHOLE_MAP.has(cp) && GROUPS.filter(g => g.V.has(cp)).length == 1) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}
*/
const VALID = new Set([...union, ...nfd(union)]); // 30ms
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
//console.log(performance.now() - t0);

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
	let prev = FENCED.get(cp);
	if (prev) throw error_placement(`leading ${prev}`);
	let n = cps.length;
	let last = -1;
	for (let i = 1; i < n; i++) {
		cp = cps[i];
		let match = FENCED.get(cp);
		if (match) {
			if (last == i) throw error_placement(`${prev} + ${match}`);
			last = i + 1;
			prev = match;
		}
	}
	if (last == n) throw error_placement(`trailing ${prev}`);
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
						if (CM.has(norm[0])) throw error_placement('leading combining mark');
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								throw error_placement(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`);
							}
						}
						check_fenced(norm);
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
	let shared = []; // TODO: can this be avoided?
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


function error_disallowed(cp) {
	// TODO: add cp to error?
	return new Error(`disallowed character: ${quoted_cp(cp)}`); 
}
function error_group_member(g, cp) {
	let quoted = quoted_cp(cp);
	let gg = GROUPS.find(g => g.P.has(cp));
	if (gg) {
		quoted = `${gg.N} ${quoted}`;
	}
	return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}
function error_placement(where) {
	return new Error(`illegal placement: ${where}`);
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

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_split, ens_tokenize, is_combining_mark, nfc, nfd, safe_str_from_cps, should_escape };
