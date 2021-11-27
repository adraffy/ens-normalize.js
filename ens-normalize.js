class TableReader {
	constructor(table) {
		this.table = table;
		this.pos = 0;
	}
	get more() {
		return this.pos < this.table.length;
	}
	read_byte() { return this.table[this.pos++]; }
	read() { // unsigned pseudo-huffman (note: assumes tables are valid)
		let {table, pos} = this;
		let x0 = table[pos];
		if (x0 < 0x80) {
			this.pos += 1;
			return x0;
		}
		if (x0 < 0xFF) {
			this.pos += 2;
			return 0x80 + (((x0 & 0x7F) << 8) | table[pos+1]);
		}
		this.pos += 4;
		return 0x7F80 + ((table[pos+1] << 16) | (table[pos+2] << 8) | table[pos+3]);
	}
	read_signed() { // eg. [0,1,2,3...] => [0,-1,1,-2,...]
		let i = this.read();		
		return (i & 1) ? (~i >> 1) : (i >> 1);
	}
}


// from coder-v2.js
function bytes_from_base64(s) {
	return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function decode2(v) {
	let buf = 0;
	let n = 0;
	let ret = [];
	next: for (let x of v) {
		buf = (buf << 8) | x;
		n += 8;
		while (n >= 3) {
			switch ((buf >> (n - 2)) & 3) { // upper 2 bits
				case 3:
					if (n < 10) continue next;
					ret.push((buf >> (n -= 10)) & 255);
					continue;
				case 2: 
					if (n < 6) continue next;
					ret.push((buf >> (n -= 6)) & 15);
					continue;
				default:
					ret.push((buf >> (n -= 3)) & 3); 
			}
		}
	}
	return ret;
}

// compressed lookup tables
// Ignored/Disallowed/Mapped/Valid/Deviation [IdnaMappingTable.txt]
const TABLE_I = decode2(bytes_from_base64('4DLTwWQnlM7ZPD72dULP/jXsbxDgNvP/jPsgk/+vxPc4DcM='));
const TABLE_D = decode2(bytes_from_base64('GWo1T41NjWTTmYyFngefm4DGmyZpSTih4DnTt5yZZkmc3oxuSbEcWPAaAcwWdrZbs7WYq844ia5cfp0o8BkJoSWLGclyKlJSUGRGVYymZpEsWM5RRSJlkSbM8hM+I1M0lnFjOUZVUWWjfIrJ5yzQksWM5RlVKSc7kRlWJVIzNmRokppt2SStmRGY3YrLaWcXOIKksyTotFSKqfFizi5qMqpLMk6mRkVRVtpZzMszSYgsaLOJPGDSSp2ZJiTRNUnZnUmO5KiTKcYJOLqUkzKpSZBpBySTJzkhvNuS8BkGTmUrgL1wG0GRTkmRZSZFkJkU5JkV5zkyLQ1kDxqbVlMuCBxx6zPi1OMU4pZaWVZmiyhVTVTTGc1zazPlcujVY+bJLJC8qUteWSY1NW8+WgnHVXNVNcsfzHTXl53SjPHe88nytV0ZXLwPLKZZMplQSSScfWamclszuRTSWysz3NTmxmiwk0PFSWa0piXWTJa8hvyHEWsrOoGiTgNQNq4HN8ZrxXFNC4XPnwG+rIDwHuy5aTKVnE6uximczmczmczmcznfsixo6zZwGrZXn51ZJbHLlZzM5UdUsxDROA/4yHED+GaPN6eA9zFOAzijgNLlRJlxjO3VNnFGjUWTbpXjz041yZCc3puVS2fGMcqmUympnM5zyTflVN1eSWYvJmPQcJwH3LasmnsllsNplJKKO+4hwFc3AdYs2nOQVLFCZVPiBU11RmMikNpJZJJJO/I2o1T41NjUmgnHnMplMm2WZ8RsONHEyjersi3uVyZa9YNrOX5dwCx15jfjkmSU49LlcuPHJZLsq4DHlVNkkmSSZRRmldhvM5RrN5nK0PgO3pxaqjGJjlRp0WZE5YUysXOkUU5hiZUuQvG5ToGcSYosyKloLOOpyVT0z6BkGTyWU5s8dWNy41PJZPqGk5vmduZz5dRVwHTY+cqLS07KKMqxbGsmxzFMXp06TJKc+MtuMz1TZqcSoyenYDileJHLNBnJMhvNc2dy1TSGhJYsZyjKakk0ZjLOp3LwFeuGXHtIoq4DJs2WTZFotdU1uJ51NVm2Nq+TF+AznPNk1OyhFUFHHilZTVo1Cy5V43pFGp26TwHD0nLTdVjryBYsbtJnKOWMlGmiqaYo5KUZp6uA7bGeAzc35lbweN7Nt5lr4DROJ8zY7eD6/j9R4Hx+hznge5nx81SaiapseU1WjVVGc4rLifBZhrey6XJnM+I6BLWruX3ijhNWyqnotnkM5R4Do8teIyUcDZxHCbXLa6Z6lRyPuZcsXp3TPOA3arJ1pVG4Yro3AY1ilmr04zwE+qnRykUlIbCTOdBMioM5xwyGUlzngPUXAdIuCz6+U38H6GP8BsM5xFTlGXgNVy13KqRcB4GP4jnUp4TYJzIUbzwGirEMp0ySqRcFyOiaZnvAaFIcbKJRNRkJJmMhJJLKJRJJJJKJUhnMhkJNRxGVmU4jmi4Djssk2Sy9Xm85LisuNcBJnGO25ZJTOrpuAxrg9YlxB2vdLNZnskN9kmcUVTZRRjyWncB6llylcrnpx11yzVVTUUT08BiZzfJauD4b/xk+wZBx/cz8Bry5ZXc52PF8/tBrPAZUc/OvnXuF2LkvL/+rbs14DcP/W/ch'));
const TABLE_N = decode2(bytes_from_base64('0HGuA0LZcX4DfjPmHBZS+E+qbEaDTkmovgLxiHA5UMgz/gOBybgfi47IZuc57iMSyvhe/T1rc6Og6vInw2LaI+CxOeTFKnnnAeTR3GwUTZBVRkFFGQUTZBjVGgcBwk3e+vNVPZJu3AY3JxWlcF09PFd7puNbAMaHDctmHr49wnDvtfZE3Ae0XwHpmqYYrwGYYpLtc71jgNcfAZG5cS3abvv4klyhTYoJLv3/HUO6x3zvkfN08FzUnp/FwGl1e/m8+NbFNjQyqb4NSklyhTYpW+/0kTcB7RfAemapnNwGYKaxTWJ2WSc/3XB8nlH/nRew4CjJOA+DgMcr4D/jfjBnyDgejf/niNl4TR8z/88twHF7bkHL8B6oyD/xlfgfLkGNf+tc30Y0BjQE4OJYgMavGNC2TGjRUJMjc9xrxAY1joxoOSZUWGfEjjWRuSYy1Sz4ocayMY0BjQGNAY0BjQGNAY0BjQGNAY0BjQGNCTEeGyAz5IcRyNTZNPiOSmfJDiORqbJp8RyUz5IcRyNTZNPiOSmfJDiORqbJp8RyUz5IcRyNTZNXVw3TioCoCoCochwGRf+9S2ThNok/96NnuOSDXWsdY4JY1xei8Vk1Ww8='));
const TABLE_W = [decode2(bytes_from_base64('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')), decode2(bytes_from_base64('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')), decode2(bytes_from_base64('4DPNi7/pu/58y9/03f9GV3/Rd/z/HZzz2+cAceWzcA8e5DO+g+QBzAcBtXfnHbsarpy7FeAt7/pu/5k19/03f8qr+/6bv+hJ7/pO/6Evv+m7/nTL3/Sd/zpff9F3/Ok9/0Hf86Z+/6bv+bJ7/nu/5s09/03f8uae/6Lv+XMvf893/Lk9/zXf8vJsQEmNYyJcex0TgCTGsZEuPY6Ltx7/qO/6HgMk8PcAHMBx/QeF/dGO7zs5/8admB/8adlo/8adlx/8adlq/8adli/8ab4uNYqqsQx/NPf/zgM0yFcBbwGPbGc1m4DFHwGI8BiW5nHeAyTNztNvAWPe+AVh4C3gLspWv51sU/AYvuWIya7wGLcBKa9w0E5bwGJZ7Joe4bGa9w1U37xwEsuVYrUbtV0BY1q23vINJ3ibK8oxR5jjtxsybTTlmZbmdC0TgJzoWjbys6x7RVlWWamck0LITj+hYisp3PgLjjOa4wcexrd6NqzDZTm2YZCaeAn4DInfluoSYzq9Vfwdaf/Gw8kf/Gw8eP/Gw8gf/Gw8ev/Gw8cf/Gw8fJ/42HjD/42Hj5v/Gw8Uf/Gw8fR/42HiD/42Hj6v/Gw8Mf/Gw8fZ/42HhD/42Hj7v/Gw8Ef/Gw8fiH/jYeAP/jYeNf/jYeSP/jYeNP/jYeQP/jYeNH/jYeOP/jYeNX/jYeMP/jYeNk/8bDxR/8bDkOIY60cikxvEt1OyYlud+wPFqTLkhxmnJDkqyQ14vkleMjdTsWKbqtyk3U7sNzOwYpua3CTczunheh4Xhu+rHTjE2OmzEsdORZDNkuITXuyeYqSV0CWXEvC77wvPOL+F9HhefVu5/8aX9R/8aX84/8aX9B/8aX86/8aX8x/8aX88n/jS/kP/jS/nm/8aX8R/8aX89H/jS/gP/jS/nq/8aX7x/8aX89n/jS/cP/jS/nu/8aX7R/8aX8+If+NL9g/+NL+V/+NL+o/+NL+U/+NL+g/+NL+Uf+NL+Y/+NL+Vf+NL+Q/+NL+WT/xpfxH/xpfyzf+NL+A/+NL+Wj/xpfvH/xpfy1f+NL9w/+NL+Wz/xpftH/xpfy3f+NL9g/+NL+OX/xpf1H/xpfxv/xpf0H/xpe914t/40fhKxMZRZlHFb1rNR1DWbOB0XgN8xyY5Dj0hyHIFrmmyZkc1mJcxLmzA5rRlxzXNsxLzbLzLm2Wl5ll5OZZeRmFRznMKDldZN1qNludHK8ky82ZJl5syTMTdkgOR5IDj94OIXg4hkAOQ25gchtzA5DfnhyvIstNmRZabMiByHIgcdxHODkt+XHHb8uON45l5xTHMvOKY4DjeOVHIcZzI4vjAOL4wDi+MUHHcWBxXFqjj+LUG/JcuM+S5cZZsvOVTAnLcwJy3OjXlucGnLwcwy8HMMry4nK8uJWXnLll5zDLycyy/MCMvzo05ijmGY5kRlrOZZblzGYyHMnmJzZgrMcwKzHODLmeZFZnmRWZ50ZTUZzQVSDVSDnNmcHP5M8OfyZ0c9ozg5/Rmxz3Nqjn+bUHOcyqOdrODnOZUHK6c2OT350crtzo5PiOdGvL88NaqIznOiM7zwimo0io3zVGfMc6N82XnLstzA4vjFRtkqM+Zo5hlucGvL8yLkBOX5kVmaJWdHOTnhpzHPDiNFR0OrOjbIDi+M5kcfyAHI6c4M+Z55lOU49wHOHgOfk4DnKOA7nHqv/Gp/P/7xbnsaxI5XjWKHLcaxY5fjWMHMcaxrWeAu4DJ8SPAYxwGU4keAxbgMnxQ8Bi3AZTinPfV/68PNfe8H3vEyT3vJFnAbl73efb2H29aT3e1d3s5Pebh3m2k+ttXrbOT/4Plf+D45Px/98f9k/+Lpv/FzJ8XEvFvJ+qb6n8=')), bytes_from_base64('n9e/5AAAAIB7v4G/pr+lARWADBkAABAaGQAAiBXDBAAAAIh0nG5eVmcBS4ASK2cBAoAiMW8CBE5QgAUED4AogCGAIgSAIXxLCgE5gAQFJAWAHXAKJAGAG3pVeAiAGXweXQQvIRZ4AmdmEoAFDEBYHwEGK2OAMmcKKnGAHlUGLHMWfAUbX3wMBCNpOFYBIzZnRgQBTQpGAwAiSyor7f6RtZ9p08gK/wByJQ8DFh8CwtDCw4ABHmLC5MLTB/8ASqyLADoABgE/ODUSASgvMCsBDB4VGAEnBCoHARUWDAUBAikiAgQngLaAyTo='), bytes_from_base64('sofg0CITgBplDjeAAHlyEQJlgAAEVwoCL3IRL1YBgAd4XS+AEgZvfGN2NwsdVoABcFUDGGMuHkYEK2eAEEsMAholFx+ACAIlUSB6IREZKndgGAMnFjNYIQwCDlUrgAJY4IEhBsLiwsM='), bytes_from_base64('spbg2oAAFzZnRoAZ4HEhBsLiwsOAAQ==')];
// CheckJoiners [DerivedGeneralCategory.txt]
const TABLE_M = decode2(bytes_from_base64('4LgNw4Dk5+A4fLSSiidIrzDFcQOyzqZIyZGcexvW686ppOMSGksy5W88oyrGDkObM4kZ6ljrzgmdJOk1LGinnBMsiTZx5M1vOCaCy8UWLTF5wTOknO6ljxzuVsyUnKJc3JnLMk6rWOvOCZyzJOq1jkmbozlmSk1LHXoxkmJNGJLPSp7KNiKprm0pY2SSZFmOKFS1nJKTsmKYvJIy1O5LbCapOCz98HmUmOPHVjy0DIKTlrJ3VZEd2sks4DW5c5qOOo5hj+Yy5fiOTU2PHrc4uzDFOAxhnFZDMU+A0bQOC1DIeL358BadgyDgeqm2lfrqkhqyBaguA5AsyHF5ZDqazLEsaxK05NRjNuWSZfdkh0O6w0LLXmRLSlROUyyrgNsoK87sDwWw4hiGIcHpp4DYjwGKy8NMypZMoch4DJVwPeycC1wGM15jJvTzW/KSlVJltc5z15JdiCyw2PMLqJCtcsmPAZBZismbozpJ0mpKdy8BoGJYudRxTgNrnVONrUsR2q3Zb+A4C/gN1mKUhJXAWzqdnHKsonMlBpry7EOBxWg0alixu3qZkozk6FKUZeA9uTy95lzufg+YJzeeTUTWvMytcj8OXLF+B56VzUUKfHpOAxR8PnebyZlQbji0pv4T0JziKnKMvAcLPwH7nPZOF2CfbZ//r5jNeA3D'));
// CONTEXTJ [DerivedCombiningClass.txt, DerivedJoiningType.txt]  
const TABLE_V = bytes_from_base64('iM2AAIAAgACAAIAAgACAAG4BEX1wgACASoA1AYZaAR+AHoIOgGRmAUcBkQz6ByaAGIAPbYC2gHfd0oWHKg86egGADHWANWOAdYAAgH2AAHd1gI6AhAGAIlQTUoEmgIUBUg==');
const TABLE_LD = decode2(bytes_from_base64('4XoDKSTLJaZysjVGIYlkxVJJKyho4k5ZDSSSVj9bvUhKam0rIdWlRNRNRMiOOlS4lVKlMb+O744xrN2RE/+MQxXM/h82Wgy1F1ScBiJJbKJRxxcB6ORE8DxjOI2PHJFZlxKkKRRKMq/8az2miQ=='));
const TABLE_RD = decode2(bytes_from_base64('4XoCceNWRos6+TjCqaOIE49juZ6VkOq4zOTIZJcTZU2I2nG+O744xrN2RE/+MQxXMvh86Ykp0mpGaXgMQxLF5uA9LI+B4zFbJMbxLLiZTQZJF/41ntdE'));
const TABLE_T = decode2(bytes_from_base64('4DLTwPpbhwHJz8Bw+WklFE6RWTl2K4gdlnUyRkyEk49jet151TScYkNJZlyt55RlWMHIM3JMlEhc9Sx050ZJKDiixopZyZFIk2ceTNazkySlSHFFi0xOdFEyUGdVrHjnpsOZFnNyXKzJOq1jpzoozGVYoscWcqSSg4osdOkGdk60VPZRsRVNc2lLGySTm9xlKlrOSUnZpDMUljKkeISWlKY3ngs/fB5k8dWPLHloCM9BVdJy1k7qsiO7ORUmZ8BraRzomcklUTVI5hj+YyZgTKTKcopsWQSJF5wSmS86oS4DGGbTPIZi1wGjaBwPFlLGpcxllm2DIeL358BadgyDgeqk2tfrqkhqyBaguA5AsyHGVKeAxdY1iVpyajGa8ueYFSJZOdDmSSsNBy85mS0pUTlSoPAbcUZD53YHgthxDEMQ4DTzwG8vgeBPAbEeAxWXhpmVLJlDkPAZKuB72TgWuAxmvMZN7ObX5SUqnmMiU5z15JKaM+NizSmqRHX2iVMeAyAujFVnKZyWdy8BodCZOLnVJiZEVwG3STIrG1qtCJW1ElTE7K1IZeA4OkrgOARMh4DEJEpDkFWUTKSg0zJ5daVwOLTmYnUsWU5RW9TMlGcnSEyTwHtrlO7p7bN5c7n4PmDn8monzM4Rk5H3MuWL8D0DpxBT49JwGKPh87zeTMqDccWlN/CehOcRU5Rl4DhZ+A/c57JwuwT7bR/9fL5qce2DgBwG4Q=='));
// emoji-zwj-sequences.txt
const ZWNJ_EMOJI = (() => {
	let r = new TableReader(decode2(bytes_from_base64('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')));
	let buckets = []; // stored by post-idna length
	while (r.more) {
		let n = r.read();       // group size
		let w = r.read_byte();  // group width
		let p = r.read();       // bit positions of zwnj
		let m = [];
		for (let i = 0; i < n; i++) m.push([]);
		let b = w;
		for (let i = 0; i < w; i++) { // signed delta-encoded, transposed
			if (p & (1 << (i - 1))) {
				m.forEach(v => v.push(0x200D)); // insert zwnj
				--b; // discount
			} else {
				let y = 0;
				for (let v of m) v.push(y += r.read_signed());
			}
		}
		let bucket = buckets[b];
		if (!bucket) buckets[b] = bucket = [];
		bucket.push(...m);
	}
	for (let v of buckets) if (v) v.sort((a, b) => a[0] - b[0]); // store sorted
	return buckets;
})();

// upgrade emoji to fully-qualified w/o FEOF
// expects list of code-points
// returns list of code-points
function upgrade_zwnj_emoji(v) {
	let ret = [];
	next_cp: for (let i = 0, n = v.length; i < n; i++) {
		let cp0 = v[i];
		next_bucket: for (let b = Math.min(n - i, ZWNJ_EMOJI.length); b >= 1; b--) { // only consider emoji that fit
			let bucket = ZWNJ_EMOJI[b];
			if (!bucket) continue;
			next_emoji: for (let emoji of bucket) { // todo: binary search
				let c = emoji[0] - cp0;
				if (c < 0) continue;
				if (c > 0) continue next_bucket;
				let j = i + 1;
				for (let k = 1; k < emoji.length; k++) {
					let cp = emoji[k];
					if (cp == 0x200D) continue;
					if (cp != v[j++]) continue next_emoji;
				}
				ret.push(emoji); // apply upgrade
				i += b - 1;
				continue next_cp;
			}
		}
		ret.push(cp0);
	}
	return ret.flat();
}

// member are 1-tuples [unsigned(cp)]
function lookup_member(table, cp) {
	let x = 0;
	let r = new TableReader(table); 
	while (r.more) {
		x += r.read();
		if (x == cp) return true;
		if (x > cp) break;
	}
	return false;
}

// member are 2-tuples [unsigned(cp), n] 
function lookup_member_span(table, cp) {
	let x = 0;
	let r = new TableReader(table); 
	while (r.more) {
		x += r.read();
		let d = cp - x;
		if (d < 0) break;
		let n = r.read();
		if (d < n) return true;
		x += n;
	}
	return false;
}

// linear are 3-tuples [unsigned(cp), n, signed(mapped)]
function lookup_linear(table, cp) {
	let x = 0, y = 0;
	let r = new TableReader(table);
	while (r.more) {
		x += r.read();
		let d = cp - x;
		if (d < 0) break;
		let n = r.read();
		y += r.read_signed();		
		if (d < n) return y + d;
		x += n;
	}
}

// mapped are (1+w)-tuples [unsigned(cp), signed(mapped...)]
function lookup_mapped(table, width, cp) {
	let x = 0, y = 0;
	let r = new TableReader(table);
	let i = 0;
	while (r.more) {		
		x += r.read();
		if (x > cp) break;
		if (x == cp) {
			let v = [];
			for (let j = 0; j < width; j++) {
				v.push(y += r.read_signed());
			}
			return v;
		}
		for (let j = 0; j < width; j++) {
			y += r.read_signed();
		}	
	}
}

// adapted from https://github.com/mathiasbynens/punycode.js
// overflow removed because only used after idna
// note: not safe to export for general use
// string -> string
function puny_decode(input) {
	let output = [];
	
	let index = input.lastIndexOf('-');
	for (let i = 0; i < index; ++i) {
		let code = input.charCodeAt(i);
		if (code >= 0x80) throw new Error('punycode: expected basic');
		output.push(code);
	}
	index++; // skip delimiter
	
	// https://datatracker.ietf.org/doc/html/rfc3492#section-3.4
	const BASE = 36; 
	const T_MIN = 1;
	const T_MAX = 26;
	const DELTA_SKEW = 38;
	const DELTA_DAMP = 700;
	const BASE_MIN = BASE - T_MIN;
	const MAX_DELTA = (BASE_MIN * T_MAX) >> 1;

	let bias = 72;
	let n = 0x80;

	let i = 0;
	const {length} = input;
	while (index < length) {
		let prev = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (index >= length) throw new Error('punycode: invalid');
			let code = input.charCodeAt(index++)
			if (code < 0x3A) { // 30 + 0A
				code -= 0x16;
			} else if (code < 0x5B) { // 41 + 1A
				code -= 0x41;
			} else if (code < 0x7B) { // 61 + 1A
				code -= 0x61;
			} else {
				throw new Error(`punycode: invalid byte ${code}`);
			}
			i += code * w;
			const t = k <= bias ? T_MIN : (k >= bias + T_MAX ? T_MAX : k - bias);
			if (code < t) break;
			w *= BASE - t;
		}
		const out = output.length + 1;
		let delta = i - prev;
		delta = prev == 0 ? (delta / DELTA_DAMP)|0 : delta >> 1;
		delta += (delta / out)|0;
		let k = 0;
		while (delta > MAX_DELTA) {
			delta = (delta / BASE_MIN)|0;
			k += BASE;
		}
		bias = (k + BASE * delta / (delta + DELTA_SKEW))|0;
		n += (i / out)|0;
		i %= out;
		output.splice(i++, 0, n);
	}	
	return String.fromCodePoint(...output);
}

// warning: these should not be used directly
// expects code-point (number)
// is_* returns boolean
// get_* returns number, list of numbers, or undefined (code-points)
export function is_disallowed(cp) {
	return lookup_member_span(TABLE_D, cp);
}
export function is_ignored(cp) {
	return lookup_member_span(TABLE_I, cp);
}
export function is_combining_mark(cp) {
    return lookup_member_span(TABLE_M, cp);
}
export function get_mapped(cp) {
	let mapped = lookup_linear(TABLE_N, cp);
	if (mapped) return mapped;
	for (let i = 0; i < TABLE_W.length; i++) {	
		mapped = lookup_mapped(TABLE_W[i], i + 1, cp);
		if (mapped) return mapped;
	}
}

// expects a string 
// throws TypeError if not a string
// returns a string normalized according to IDNA 2008, according to UTS-46 (v14.0.0), +CONTEXTJ, +ZWJ EMOJI
export function idna(s, ignore_disallowed = false) {
	if (typeof s !== 'string') throw new TypeError('expected string');
	let v =  [...s].map(x => x.codePointAt(0)); // convert to code-points
	const empty = [];
	return String.fromCodePoint(...upgrade_zwnj_emoji(v.map((cp, i) => {
		if (is_disallowed(cp)) {
			if (ignore_disallowed) return empty;
			throw new Error(`disallowed: 0x${cp.toString(16).padStart(2, '0')}`);
		}
		if (is_ignored(cp)) return empty;
		if (cp === 0x200C) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(TABLE_V, v[i - 1])) { 
				return cp; // allowed
			}
			// rule 2: {L,D} + T* + cp + T* + {R,D}
			// L,D,T,R = Joining_Type
			if (i > 0 && i < v.length - 1) { // there is room on either side
				let head = i - 1;
				while (head > 1 && lookup_member_span(TABLE_T, v[head])) head--; // T*
				if (lookup_member_span(TABLE_LD, v[head])) { // L or D
					let tail = i + 1;
					while (tail < v.length - 1 && lookup_member_span(TABLE_T, v[tail])) tail++; // T*
					if (lookup_member_span(TABLE_RD, v[tail])) { // R or D
						return cp; // allowed
					}
				}
			}
			return empty; // ignore
		} else if (cp === 0x200D) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(TABLE_V, v[i - 1])) { 
				return cp; // allowed
			}
			return empty; // ignore
		}
		return get_mapped(cp) ?? cp;
	}).flat())).normalize('NFC');
}

// primary api
// expects a string 
// throws TypeError if not a string
// returns a normalized string ready for namehash
// throws Error if not normalizable
export function ens_normalize(name, ignore_disallowed = false) { // https://unicode.org/reports/tr46/#Processing
	// idna() will:
	// 1. map all full-stops to "." (see: Section 2.3 and Section 4.5)
	// 2. apply ContextJ rules (see: Section 4.1 Rule #7) [as-of v14.0.0, ContextJ does not span a stop]
	// 3. apply Section 4 Processing Rule #1 (Map) and Rule #2 (Normalize)
	return idna(name, ignore_disallowed).split('.').map(label => { // Section 4 Processing Rule #3 (Break) + Section 4.1 Rule #4
		if (label.startsWith('xn--')) { // Rule #4 (Convert)
			label = idna(puny_decode(label.slice(4)), ignore_disallowed);
		}
		// Section 4.1 Rule #1 (NFC) is already satisfied by idna()
		// apply Section 4.1 Rule #2
		if (label.length >= 4 && label[2] == '-' && label[3] == '-') throw new Error(`double-hyphen at label[3:4]: ${label}`);
		// apply Section 4.1 Rule #3
		if (label.startsWith('-')) throw new Error(`hyphen at label start: ${label}`);
		if (label.endsWith('-')) throw new Error(`hyphen at label end: ${label}`);
		// apply Section 4.1 Rule #5
		if (label.length > 0 && is_combining_mark(label.codePointAt(0))) throw new Error(`mark at label start: ${label}`);
		// Section 4.1 Rule #6 (Valid) is satisfied by idna() following EIP-137 (transitional=N, useSTD3AsciiRules=Y)
		// Section 4.1 Rule #7 (ContextJ) is satisfied by idna() 
		// Section 4.1 Rule #8 NYI
		return label;
	}).join('.');
}