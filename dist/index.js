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

function read_counts(n, next) {
	let v = Array(n);
	for (let i = 0; i < n; i++) v[i] = 1 + next();
	return v;
}

function read_ascending(n, next) {
	let v = Array(n);
	for (let i = 0, x = -1; i < n; i++) v[i] = x += 1 + next();
	return v;
}

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// return unsorted? unique array 
function read_member_array(next, lookup) {
	let v = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < vN[i]; j++) {
			v.push(vX[i] + j);
		}
	}
	return lookup ? v.map(x => lookup[x]) : v;
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
		let x = next();
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

function read_emoji_trie(next) {
	let sorted = read_member_array(next).sort((a, b) => a - b);
	return read();
	function read() {
		let branches = [];
		while (true) {
			let keys = read_member_array(next, sorted);
			if (keys.length == 0) break;
			branches.push({set: new Set(keys), node: read()});
		}
		branches.sort((a, b) => b.set.size - a.set.size); // sort by likelihood
		let temp = next();
		let valid = temp % 3;
		temp = (temp / 3)|0;
		let fe0f = !!(temp & 1);
		temp >>= 1;
		let save = temp == 1;
		let check = temp == 2;
		return {branches, valid, fe0f, save, check};
	}
}

// created 2022-09-23T08:57:36.801Z
var r$1 = read_compressed_payload('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');

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

function str_from_cps(cps) {
	return String.fromCodePoint(...cps);
}

// created 2022-09-23T08:57:36.839Z
var r = read_compressed_payload('ABMCugDhCCoAOQDlACwAdAAgAC8AIAAuABEAKgARACUEsgNvALYNshvF7FWxVQIlGJ4C4ABI9mVnAG7hCggtcHBwcPBwAmsJ7aJBjGxl96lHXKMATW3t5wBz+QLvyvgAEiwviiAIPnBwcHBwcHBwbWBwugagjgF+1BEreXcWiH9dACbnXUIE9xoq92WlU+Vw7XBnZf4Al0QDQgCWAEgMLAHuBcsDhjj0MQb6AvcA7QShBKIEowSkBKUEpgSnBKgEqQSqBKwErQSuBLAEsgSz+g8FPAGVBT0BlQU+AZUFCSYFCiYFCyYFQgVDBWEGAgtGC0cNKQ05DakNuQ5iDmMOaw5lHMECEhy/AgwLDgDQVhzrESAlBIILh3Q0mtZMBNN/tweezVcukgBxxRoB2Yi8VjnTBh0dnANVKNRZEgIHAAE5o9IADjAmDgUPCo0BAgMAhy9T7A/GOcEeFjYEiwMSfBXkLx8A0F4EnxHrFnIc6BoCNwEBRAUAEDyclamdDM8ATc0ARABlBPcB04RvAzEBXj4ZnQNXJgPKyyEBDwExSQHxLQMAEP9VM2k3khtjHgBIBR8CxwYIK5IAUw64Ae8LBOF3hBpCAOAAwlJSBDgIngB3jQCoAVZWsGVFFYgMrgP6AKwFSAUVEAIBAgYuGY4RJgDj3QJNGYocvgJOAjYHCNBEGAPVCxoTzzEPCEl0bfPuvtUITQDw/wGdAvqZGTs/ACElHwAzAD4pOTZc5AL7CmUCjtcChw4/xG+/AsYBAoQoBXE4cQVDAK1DAvqfodkA1wTxOPUe/ZH7TAAUqRqjTSsC1AV3UwUDNsVtBwEBAQEFAUMArpsC+T8FF6QD7OkE2yuAV1I9NAIFOgVJBKYE2wWs5QAV90mYTp0C9DreQC4KVwnJb/F3hAZzEE0n1xEpDGUB5wFtDh9MCgUjBm0E+x+vGUsP/5XOCNcuDw0fJxUu04CMJCcqtQYfTCY9Dwt/UZoPiwuXChU6lYGAA1MBPyK9Cw8NawifESUK+50OFxF3B2sEB0nMANcHMwtDHWcV5yZCYt4LOzmpBy0bKAvBJuETW3suBgUaUwZ/AVsbMQEBLxmF4lpjXE4QT5EGNQtXI/kU2lBSDVdA6Xh6Gk0HRyXbAsNDokq5UWgexSIoPG8NmC5FUa4IJzw3GYELszzQRt1FQBIEPr89eiJ7TF4EZ7EsYSe9CgEPtwzrfKQBiwlTCeMMoxNjEUk39whrB0tfl1YnRwhTRsdgzAUp0QQlFAMDPQVxCXMHRQPnHF8TYBVbBT+BVgAJAyU3By7lAsFWsgFJBf0PVyAREIJIEg8bCM0ClwO1Jh0AXxVTAEkizQh1lQCRkApTNy79CPlqniOmA5kVGZMRpQfDDokH2RxlFfEdE3D6Xj2GOijV4QmNAacJywGRBRUIOzWNjNIgc2eFi4oYzSCTQXFeLgJjDJcV0UTvh6oCvQ+dEk0BZwGlB2sNMwKpEh8RnRUQxwkdhjY15zQqOlcEgSG1IEMKWQOBbQALWScrDSqbAdUSlAM+NG94IGfdYOhWGC8HSzL3QZIiIwvET/8MzhrzGHRUYBoWB/EEJRslKBxBiQYxA9U1RTp/NCAE7wubCL0JcQB7DtULSQgJGJwKo40CAWO9AeknywOJw7UCocEGaQUHPQCZPbkFqwAXAE8C2QjVADcBAQOJAGsC3wfPAEsHAQC3cwFvA1kbYQFTABcCwQPFCGP9AcdhAiVbBE31DEcBKWlufALD4wKAnGbUBg+KAsACe2cBf1cEN4B5gwPhowATEQENAH0GRQAReQFH3Xz9TAAVdQIRoV0A+QEtADdnBzdzAf8CJRCfAOkBkQtjCdTl5wF/ABtbALUARxMjnQQCCQK7AQ8AZwCxACMBhQB/BYsAKwYFAoF7EQFDY0pdEomTAe0DUQFlAT8Aqwb9v9f7OQlRBJ8IBQIQTRYTAu9gB+czAyMRE/9C9wK+EIehkgMCZLMCYnSNC3/hL40gN1ICoikCaMoRFwJmOwKftjhNPQJmbQJmWAsEoASxAwN/RQN+xA05ODmpB0k5tDpVJx0rVQEDIwUCbE8CMmg4PBsCbfkCbeAbACG8ETFlmSV3EV0VAQ8BmQEQARMAfDcHygy/ATA9I/QAP+cCd2ECdtQPGQFxAnl9dQJ47E8JjgANReANRwkCfHECevobDwkCfTsCfSIFiwVSSDJIrw2VVgKBnwKAMgKANwJ/4BNJikqNRxtJSv4C0TMC0P5LWRkDiIEDiBhE95FkAvLTXTUDA+ADTABMX1cFNQABTX4sTeECi3ECiwrzTRk5DAdPGSUHdZk36QKOaQKOjnLJJ7MCjwsCjo6qKFHmU2cbLzxTBlS3KwKULQKTPgEbAE5VUFXhVgI4LE0px7gzE3iYRW1rBgKX0QLv5FhT2gCLVwKWwQKWrs4A21neWjuzfwBtApbnApaAXHZdAwKZ/QKZllz8XTlLApzNOfQ6zwKcSAKfzQKe6g28AE9BY1xBDwsCniMCnsQA529hZmIhAp8FAqCgAdsCntFRAp6A1yZj+mRZV10CJ+ECJrACoS0CoH4Cow8CofYLJwKmYQKmABsCqDEArwKoJBNormjjADUbGxl7ak5rAwKtFQKs4AKtmQKtNAJXTwJWDgKyEx8ACQMfgAlsyQKy7z8lArMaSW0SbZVtepEDJf8Cto5tcW7CAyl3AriQArl5RwK5XKlwaHETBQK9SwK8DHDIAzJDAr66cjQDM6MCvkxzVHOBKwLD/QLDNnO0dH1nd3USAzzZLwM8zAM98QLFrgLGeQLGQrsHAsibgwLIdgLJgQLJYAJkzwLeBHirk3jgeVdMAgMY1Q1nNAMCYiYaJZVWez0VXsRe7QVDAs+dAs+eYX2FAAQAJUXRAPjfEQLPpQFbABwDTkR+fTcC3FkC27wC0oEDUo4DU5EBMwNVvoC7CQdxMv1IAB+SdyeCToMFMYMAg78C2vkC2hCEQoR7p24DhtcAYQNkQAOGo4sAKwCHAt+XAt7qHaWpAuJh7UYB82IOWQH0zQHzBLkC7CUnAumiqzEC6ysC6xYBK3kB6ykC7rsC686W3Jc1Au5xA4YSmKtxEnHTAvM1AJsDjkgBmcUC90UDkaADkrkC98oC+gsC+JiaTprd7Sdpm1ADnbUC/ywBTQBrn04vn+UDBb8DppwDpwsBA/cDBpyhuqI3BTsDDHsC8gBxNQ0rARNzJSVJBzEfIYUNAUMAJRMDnQE5yRGZNwDFEV9d6eHvAA0BuwULBQMVBQvLFLFDBGsCLRcvWyEnHwc3Uw7PCdEfBQ0fAJMvBymJD/cDKQHPAOkF6wBvPZ9zAWAxMDEwMSwxMDEwMTAxLjEuMTAxMDEwMTAxLDEwMTAxMDEuMS4xMDEwMTAxMDEuMS4xMDEwMSwxMDEwMS4xMDEwMSoxMDEwMS4xMDEwMTAxLjEwMS4xMDEwMTAxMDEwMSwxLDEwMTAxMDFGMSQxWDEgMSQxJDG/MTAxMDEwMWAxAXUBsjEALjEoMSgxAedYAKcDQDYxIjGfMS4xDDEAXjEwMSgxMDEoMTAxJDEwMSoxMDEqMTAxNDEuMUgxPjEoMdMxMjEAPDECbwKcMQQPA7AEwzNSCQkVFAkDdwoZBwYxNygHU64xPDEwMSYxADcAdjEuMS4xMDEkMQBFAGgxRDEwMTAxKDEoMQKpMzI3AAcYEwOdASwDACE8C/c0DwEpPNFZ8ePpABcBwwUmU3N0MwUmABsUsUM08jEuMTAxMDG7MQA2MTAxMDEwMTAxAE0AjDEwMQJ3ArYxLjEuMTAxMDEwMTAxLjG9MQA4MTAxMDEuMTqFOsYxMDEuMTAxMDEuMTAxMDEwMb8xMDGfAOoxMDEsMTAxOsE7AjEuMTAxAL848zsOMTAxMDEwMS4xMDEwMQDXARoxMDEuMTAxMDEwMTAxLjEwMS4xLjEwMTAxFAkA/QFsMTAxszEwMTAxMDE6bTouOis7qDEwMTAxuzEwMTAxMDE6jTvQMTAxJDEwMbsxMDEwMTAxOqE5SgGIMTAxAWUBnjEwMTAxMDEFYTWPNdA13zWYNac16DX3NbQ1wzYENhM10DXfNiA2LzXkNfM2NDZDNfg2BzZINlk2EDYfNmA2bzZgNV8TUzZsNm82bjb7NzoEwjyJNmoCAzcPN1I3QTb8ExITUje7N2IEPATiPJk2VjdLN54FOr9pUyEfQwZDORhDEkM9CydOGTEPQQnNWp8NWoMHVTgjAgDpsQDp4hoFAwEUWwUACQMbAdUA7wXpAG81pQTxKz4AACs+AAA1PgAzKAQxOjUyOzw9JgY9JgAEPSYGOyYnJgIrPA8OAAcIASk4AQYNGyQxNgABAQMCBYcEwfUjJvEBJSAjJgAnIiPv7xgXwyPXGwKhdglf4xT/LxAsKQ1QKQ0ESklEKSYvTjUNDC5LSCkoKQ1IACkuS0QpKCkNAglIMTYpKDMNQikkAAMDKyQDJSQAAwMxJAADMTY3JBEYc04Yc04YFRgVGHNOGHNOGHNOGHNOGBUYFRhzTBhzThhzThhzdHtuc257ent6c2h1aHNoF01oGRh7ensKWbNUugUGARTnywMfIwG3BAsA1QXzAG9bAwoDPgIADSwEpXIJRBjQcAlvXGwJYwAAVAJlCfcDLC4AGQimziTrDxRsXQEHCQBJ4gJxFAHxAAACAwH1dG3tAGkBkADcNw02AgAaAO8MYMdXAAUANqrVCE0AJTUFC/40WgEOgxfFKXYa3/sD/I9uS3VANTQ3XBlcVW2U9A7Kf+wUbeNgVfOQ0jnth1r/AmJwCuJ+bjJCnzyJKwrLaSnI7BZdJ7zYfwhaB6OozdWYNd+TUmHKyyB2bMQ2SXisfTa3xOUxASuPHAEIEGZD42dzXB5cd/21m7UbBZ3kP4J2BnToQQVpWwNKkICH0EYrlFoHExilPTcSHRli97wu3uhz2d3UF52MuJYHtmMBDUkEZT/NWRggi8mXnbae4/TLY3lbWwZC0XZ8sX7jOGTfqWV4zC1WG4u/G6JgRyw7NSQECncFm2VZ2WWpsrV/c9jiJCLgD7vUijJil/9O9/+zyXSYbKDTzMHw3bOpZ3irYJAHu/wW5mk0xPocvChuaeNfuKHezBnavY8z6Zlan5pc7BRttiK8rg6VDl14sKA3+44N/BsR0tFbEFqYoOYhQeDlN2PO4dCKxwCDXdC+X4sXSEcwpiT79T1ntHsfky0r28ufm/V0LuBPgxaj0daKaY5izrD3HRXDJDs1lA/PHgFwjqiQaLDeCILljxnvOl2hSN+PVYpJisd+j/ItP8sTprr6sDPd9qyee80xAyN5fm1g1UQoyuhG58xAxAczRst3ElTC4KiiwiAJub6xNO7v+zfL/AbD/z9e9t0fWmDysNAoF3FHNZEn5IohAlVerw4+3YY6K10zQcCqoWO91PFiJuuq0E0KbTDx0MGHO17ozuYKZBM5cT67k3+ujfXmjkcwE3J3XmOoEoO4OkEYIWy4gyx8c10e4H7Xdl1Ra5vR8PQ7JQgw5XWbxA7RQMA2WMAkDmCEnzLAbX5gBrJSQn1aNrLQA6HsRYqidepmjPNqOTpTPdbgDF/nLY+sJ3JILu7Cjv9vpW0aB9mV2Qh+RDlfc+LPI9oaA76rxPpludJ946MFH+x+wCsQR8jgwJsTI61KqUxKNjsv5LebeOQLJsp0/roSqA1SQa965qqA1r5ZUrQQ24tBXNZCsMzu6HliM4u/M5mC4GRR2YREhJNAlOC2NIvpJw6rz10M9yPkXhLWXKxhsVd6DQtQ6mxBvSIhhXaNHJR+mT2CRXPEOpEe6BiIl2NHTl2urQXXoV8ZZVw/DKVxPbTj2BGJiouL1uIldPYwFWoaIIPp1ATgbrRn5kf/DHv2eVtBqLk3RP/dqxxSvZSCs+z7rSaqLRJ92Xo9qFfk3sikfXK/Ve2RlKC5wBzAyEp7LsZG6rRMtagwiILAYv0oreDHFgbT/sGbRBV1P9IAAkKAJ73ykMpUHJ8fZFwXZPn+AnijupXWm9YM8I4FHSVSXPHyHXrkDwcvHvLBVgcr2Krd2BgDt0xc4KfS0ePIaLXTpZJzcyWiE95aWby+7p5dt84tMGjXbXNQ14tZkt91zHtsnjbt1W05WaWfmIu8tPci3jSYCNBeK23ePlxOSAxtaDu6DuqfhbSc5AcBqaURTB8BauWt2XUi6ea29H5qdJ6+BFgAxhlBKFvjmQoSQ98MubD683kwFPpWDFv9G2Bf9k4R8lmXm+4rvaOLdMgJkj7lG/5FqudOahFDnpiJEoVWyuDQWLXUthXjyZdeV/V8AJAioskQk+xWHcxjAuGj+vqG3/qyX85OhMcM2g2aAQmOWGR2j5JmtjpBILiDvoNSSXxz3YjPvp5upXeBzDCDQG7V84EDs0FzK/B23kn76iSJ6Pc19oGTGBUc9jEWN63UQOGEWb+lMDnyQqh/lLszwm4vo9fBXcMxCLYasLiNI58fTuV/RHDrikYLicm+9P+wReH86kuk/8r4hBHrDrnpHmc9+Uda4PPWuV7l4SNLZG9/UeLslvFbQa3opVzjHEITwIT1XsmxoOO45M773HFCQnc25nssCQ6I9A1FDC8FSmmzlcBpJBmf9gFxkwY+I1nvjFiKv52SU0eyOjaZUmCilv2mTusSYv55bnqcknjsED9jTGqN01XWP6XDtvJvGmpAcvs8aPkkqgU52kFkywMv5aojED3bDX1LoGR2sEcwYcrnW9WRCXN7rLAAQ7rXb+IDmevdbZg+YCMkMn23bPA2J10pjN4RcExiHLLnEEM/Fd6quESnTbzJZOUO9tMduua8Tf264v39ncohsbD6UxB+Nhy4GhQQnJMV4PXmQE5Df1/O9sOn6DZ0QUVlkgv0/CA9bd6S0wTrkPxHRSHrF8ox/2mRh4jLeV2qhm1eALV+Ze3kwL/PR0/GK8hvMlNxqNlUGDzXiKlsXQ3ZPLTsiUt18XtjK1g3u+HXwJDPCu+k2J0qPowRoTIC8HSSraAiZOSRd3hFFAbnG+E9RnLypgK8vTkD1I7+GXSO6qhbSsocZuayTs9Q/CEBvMLF0VNS0ILbMv1WOTz1AqX4Stbzilk3ipADwZHUWUXwRmqiB3MSnPULZJk3vt7SR3sONsAX8sly0E/T+n+JcolcdlYP0h6JdEX+0DqpMqTR4ZD0J0KAGC0bn8DbtFFRnpVtp7uhAUFQ52TtYMYQ3W/TutF1sVQz4SdTE3ev0pc+QmqKSBmtpA52KPSfbUKmauUAYqXftrKx5u7F+HC7Az8zyLss3coybyS6afKHEipvGgNt9T+SV3Jhjvj/R41mLmlCGs9Y9m6GH75LkVXgEafdtm+r3/feRftXo3mXr9BhOtVoXbrWJWTLfeGanamW8XQ+YX4+zCWhvp9zsQ7qN03OVs8OLsCDoJO0LPvcH8P0cLP2F16PogPBIJLwO+Ro7Qm+smIjOFFvsVykm0leU8dlO0EpDuiZaUsfQsD0vqkb1QO3nPo9SDf7+hHnkzRv5sVcuzfFezhleH0YxUb2hUuod0LaMVJ4H8JAAcpNd+87Y1UBfXv7KmchplE');

// https://unicode.org/reports/tr15/

function unpack_cc(packed) {
	return (packed >> 24) & 0xFF;
}
function unpack_cp(packed) {
	return packed & 0xFFFFFF;
}

const SHIFTED_RANK = new Map(read_array_while(() => {
	let v = read_member_array(r);
	if (v.length) return v;
}).flatMap((v, i) => v.map(x => [x, (i+1) << 24]))); // pre-shifted

const EXCLUSIONS = new Set(read_member_array(r));
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

const SORTED_VALID = read_member_array(r$1).sort((a, b) => a - b);
const VALID = new Set(SORTED_VALID);
const IGNORED = new Set(read_member_array(r$1));
const MAPPED = new Map(read_mapped(r$1));
function read_sorted_valid_set() {
	return new Set(read_member_array(r$1, SORTED_VALID));
}
const CM = read_sorted_valid_set();
const ISOLATED = read_sorted_valid_set();
const SCRIPTS = [
	['Latin', read_sorted_valid_set()], // latin gets priority because of ascii
	['Greek', read_sorted_valid_set(), read_sorted_valid_set()],
	['Cyrillic', read_sorted_valid_set(), read_sorted_valid_set()]
];
const EMOJI_SOLO = new Set(read_member_array(r$1));
const EMOJI_ROOT = read_emoji_trie(r$1);
const NFC_CHECK = new Set(read_member_array(r$1, SORTED_VALID));

const STOP = 0x2E;
const HYPHEN = 0x2D;
const UNDERSCORE = 0x5F;
const FE0F = 0xFE0F;

function check_leading_underscore(cps) {
	let i = cps.lastIndexOf(UNDERSCORE);
	while (i > 0) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error(`underscore only allowed at start`);
		}
	}
}

function check_label_extension(cps) {
	if (cps.length >= 4 && cps[2] === HYPHEN && cps[3] === HYPHEN && cps.every(cp => cp < 0x80)) {
		throw new Error(`invalid label extension`);
	}
}

// check that cp is not touching another cp
// optionally disallow leading/trailing
function check_surrounding(cps, cp, name, no_leading, no_trailing) {
	let last = -1;
	if (cps[0] === cp) {
		if (no_leading) throw new Error(`leading ${name}`);
		last = 0;
	}
	while (true) {
		let i = cps.indexOf(cp, last+1);
		if (i == -1) break;
		if (last == i-1) throw new Error(`adjacent ${name}`);
		last = i;
	}
	if (no_trailing && last == cps.length-1) throw new Error(`trailing ${name}`);
}

// ContextO: MIDDLE DOT
// https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
// Between 'l' (U+006C) characters only, used to permit the Catalan character ela geminada to be expressed.
function check_middle_dot(cps) {
	let i = 0;
	while (true) {
		i = cps.indexOf(0xB7, i);
		if (i == -1) break;
		if (cps[i-1] !== 0x6C || cps[i+1] !== 0x6C) throw new Error('ContextO: middle dot');
		i += 2;
	}
}

function check_scripts_latin_like(cps) {
	// https://www.unicode.org/reports/tr39/#mixed_script_confusables
	for (let i = 0; i < SCRIPTS.length; i++) {
		let [name, script_set, whole_set] = SCRIPTS[i];
		if (cps.some(cp => script_set.has(cp))) {
			for (let j = i + 1; j < SCRIPTS.length; j++) {
				let [name_j, set_j] = SCRIPTS[j];
				if (cps.some(cp => set_j.has(cp))) {
					throw new Error(`Mixed-script confusable: ${name} + ${name_j}`);
				}
			}
			if (whole_set) { // aka non-latin
				// https://www.unicode.org/reports/tr39/#def_whole_script_confusables
				// if every char matches the script is confusable
				if (cps.every(cp => !script_set.has(cp) || whole_set.has(cp))) {
					throw new Error(`Whole-script confusable: ${name}`);
				}
			}
		}
	}
}

// requires decomposed codepoints
function check_cm(cps) {
	for (let i = 0, j = -1; i < cps.length; i++) {
		if (CM.has(cps[i])) {
			if (i == 0) {
				throw new Error(`leading combining mark`);
			} else if (i == j) {
				throw new Error(`adjacent combining marks "${str_from_cps(cps.slice(i - 2, i + 1))}"`);
			} else {
				let prev = cps[i - 1];
				if (prev == FE0F || ISOLATED.has(prev)) {
					throw new Error(`illegal combining mark`);
				}
			}	
			j = i + 1;
		}
	}
}

function ens_normalize_post_check(norm) {
	for (let label of norm.split('.')) {
		if (!label) throw new Error('Empty label');
		try {
			let cps_nfc = explode_cp(label);
			check_leading_underscore(cps_nfc);
			check_label_extension(cps_nfc);
			check_surrounding(cps_nfc, 0x2019, 'apostrophe', true, true);
			check_middle_dot(cps_nfc);
			check_scripts_latin_like(cps_nfc);
			// replace emoji with single character
			let cps_nfd = nfd(process(label, () => [FE0F])); 
			check_cm(cps_nfd);
		} catch (err) {
			throw new Error(`Invalid label "${label}": ${err.message}`);
		}
	}
	return norm;
}

function ens_normalize_fragment(frag) {
	return str_from_cps(nfc(process(frag, filter_fe0f)));
}

function ens_normalize(name) {
	return ens_normalize_post_check(ens_normalize_fragment(name));
}

// note: does not post_check
// insert 200B between regional indicators so they do not collapse into flags
// alternative solution: only allow valid flags
function ens_beautify(name) {
	return str_from_cps(nfc(process(name, x => x))).replace(/[\u{1F1E6}-\u{1F1FF}]{2,}/gu, s => [...s].join('\u200B'));
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
}

function process(name, emoji_filter) {
	let input = explode_cp(name).reverse(); // flip so we can pop
	let output = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			output.push(...emoji_filter(emoji)); // idea: emoji_filter(emoji, output.length); // provide position to callback
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				output.push(cp);
			} else if (!IGNORED.has(cp)) {
				let cps = MAPPED.get(cp);
				if (cps) {
					output.push(...cps);
				} else {
					throw new Error(`Disallowed codepoint: 0x${hex_cp(cp)}`);
				}
			}
		}
	}
	return output;
}

function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let saved;
	let stack = [];
	let pos = cps.length;
	if (eaten) eaten.length = 0; // clear input buffer (if needed)
	while (pos) {
		let cp = cps[--pos];
		let br = node.branches.find(x => x.set.has(cp));
		if (!br) break;
		node = br.node;
		if (node.save) { // remember
			saved = cp;
		} else if (node.check) { // check exclusion
			if (cp === saved) break;
		}
		stack.push(cp);
		if (node.fe0f) {
			stack.push(FE0F);
			if (pos > 0 && cps[pos - 1] == FE0F) pos--; // consume optional FE0F
		}
		if (node.valid) { // this is a valid emoji (so far)
			emoji = conform_emoji_copy(stack, node);
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	if (!emoji) {
		let cp = cps[cps.length-1];
		if (EMOJI_SOLO.has(cp)) {
			if (eaten) eaten.push(cp);
			emoji = [cp];
			cps.pop();
		}
	}
	return emoji;
}

// create a copy and fix any unicode quirks
function conform_emoji_copy(cps, node) {
	let copy = cps.slice(); // copy stack
	if (node.valid == 2) copy.splice(1, 1); // delete FE0F at position 1 (see: make.js)
	return copy;
}

// return all supported emoji (not sorted)
function ens_emoji() {
	let ret = [...EMOJI_SOLO].map(x => [x]);
	build(EMOJI_ROOT, []);
	return ret;
	function build(node, cps, saved) {
		if (node.save) { // remember
			saved = cps[cps.length-1];
		} else if (node.check) { // check exclusion
			if (saved === cps[cps.length-1]) return;
		}
		if (node.fe0f) cps.push(FE0F);
		if (node.valid) ret.push(conform_emoji_copy(cps, node));
		for (let br of node.branches) {
			for (let cp of br.set) {
				build(br.node, [...cps, cp], saved);
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
const TY_ISOLATED = 'isolated';
const TY_NFC = 'nfc';
const TY_STOP = 'stop';

function ens_tokenize(name) {
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({type: TY_EMOJI, emoji, input: eaten.slice(), cps: filter_fe0f(emoji)});
		} else {
			let cp = input.pop();
			if (cp === STOP) {
				tokens.push({type: TY_STOP});
			} else if (VALID.has(cp)) {
				if (ISOLATED.has(cp)) {
					tokens.push({type: TY_ISOLATED, cp});
				} else {
					tokens.push({type: TY_VALID, cps: [cp]});
				}
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
				let cps = nfc(cps0); // this does extra work for nf-native but oh well
				//if (cps0.length === cps.length && cps0.every((cp, i) => cp === cps[i])) { 
				if (str_from_cps(cps0) === str_from_cps(cps)) {
					i = end - 1; // skip to end of slice
				} else { // bundle into an nfc token
					tokens.splice(start, end - start, {type: TY_NFC, input: cps0, cps, tokens: collapse_valid_tokens(slice)});
					i = start;
				}
				start = -1; // reset
			} else {
				start = i; // remember last
			}
		} else if (token.type === TY_EMOJI) {
			start = -1; // reset
		}
	}
	return collapse_valid_tokens(tokens);
}

function is_valid_or_mapped(type) {
	return type === TY_VALID || type === TY_MAPPED;
}

function requires_check(cps) {
	return cps.some(cp => NFC_CHECK.has(cp));
}

function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type === TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type === TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

export { ens_beautify, ens_emoji, ens_normalize, ens_normalize_fragment, ens_normalize_post_check, ens_tokenize, nfc, nfd };
