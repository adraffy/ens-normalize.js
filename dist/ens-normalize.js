export const VERSION = '1.1.0';
export const UNICODE_VERSION = '14.0.0';
// injected from ./build-source.js
function bytes_from_base64(s) {
	return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
// injected from ./build-source.js
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
// injected from ./decoder.js
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
// injected from ./decoder.js
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
// injected from ./decoder.js
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
// injected from ./decoder.js
function lookup_mapped(table, width, cp) {
	let x = 0, y = 0;
	let r = new TableReader(table);
	while (r.more) {		
		x += r.read();
		if (x > cp) break;
		if (x == cp) {
			let v = [];
			for (let i = 0; i < width; i++) {
				v.push(y += r.read_signed());
			}
			return v;
		}
		for (let i = 0; i < width; i++) {
			y += r.read_signed();
		}	
	}
}
// injected from ./decoder.js
function lookup_linear(table, step, cp) {
	let x = 0, y = 0;
	let r = new TableReader(table);
	while (r.more) {
		x += r.read();
		let d = cp - x;
		if (d < 0) break;
		let n = r.read();
		y += r.read_signed();
		if (d < n && d % step == 0) return [y + d];
		x += n;
	}
}
// injected from ./decoder.js
function decode_emoji(table) {	
	let r = new TableReader(table);
	let buckets = []; // stored by zwnj position
	while (r.more) {
		let n = r.read();      // group size
		let w = r.read_byte(); // group width
		let p = r.read();      // bit positions of zwnj
		let m = [];            // columns of cp
		for (let i = 0; i < n; i++) m.push([]);
		let z = []; // position of zwnj
		for (let i = 0; i < w; i++) { // signed delta-encoded, transposed
			if (p & (1 << (i - 1))) {
				z.push(i);
				m.forEach(v => v.push(0x200D)); // insert zwnj
			} else {
				let y = 0;
				for (let v of m) v.push(y += r.read_signed());
			}
		}
		for (let b of z) {
			let bucket = buckets[b];
			if (!bucket) buckets[b] = bucket = [];
			bucket.push(...m);
		}
	}
	return buckets;
}
// injected from ./utils.js
function escape_unicode(s) {
	return s.replace(/[^\.\-a-z0-9]/igu, x => `{${x.codePointAt(0).toString(16).toUpperCase()}}`);
}
// compressed lookup tables
const TABLE_I = decode2(bytes_from_base64('4DLTwWQnlM7ZPD72dULP/jXsbxDgNvP/jPsgk/+vxPc4DcM='));
const TABLE_D = decode2(bytes_from_base64('GWo1T41NjWTTmYyFngefm4DGmyZpSTih4DnTt5yZZkmc3oxuSbEcWPAaAcwWdrZbs7WYq844ia5cfp0o8BkJoSWLGclyKlJSUGRGVYymZpEsWM5RRSJlkSbM8hM+I1M0lnFjOUZVUWWjfIrJ5yzQksWM5RlVKSc7kRlWJVIzNmRokppt2SStmRGY3YrLaWcXOIKksyTotFSKqfFizi5qMqpLMk6mRkVRVtpZzMszSYgsaLOJPGDSSp2ZJiTRNUnZnUmO5KiTKcYJOLqUkzKpSZBpBySTJzkhvNuS8BkGTmUrgL1wG0GRTkmRZSZFkJkU5JkV5zkyLQ1kDxqbVlMuCBxx6zPi1OMU4pZaWVZmiyhVTVTTGc1zazPlcujVY+bJLJC8qUteWSY1NW8+WgnHVXNVNcsfzHTXl53SjPHe88nytV0ZXLwPLKZZMplQSSScfWamclszuRTSWysz3NTmxmiwk0PFSWa0piXWTJa8hvyHEWsrOoGiTgNQNq4HN8ZrxXFNC4XPnwG+rIDwHuy5aTKVnE6uximczmczmczmcznfsixo6zZwGrZXn51ZJbHLlZzM5UdUsxDROA/4yHED+GaPN6eA9zFOAzijgNLlRJlxjO3VNnFGjUWTbpXjz041yZCc3puVS2fGMcqmUympnM5zyTflVN1eSWYvJmPQcJwH3LasmnsllsNplJKKO+4hwFc3AdYs2nOQVLFCZVPiBU11RmMikNpJZJJJO/I2o1T41NjUmgnHnMplMm2WZ8RsONHEyjersi3uVyZa9YNrOX5dwCx15jfjkmSU49LlcuPHJZLsq4DHlVNkkmSSZRRmldhvM5RrN5nK0PgO3pxaqjGJjlRp0WZE5YUysXOkUU5hiZUuQvG5ToGcSYosyKloLOOpyVT0z6BkGTyWU5s8dWNy41PJZPqGk5vmduZz5dRVwHTY+cqLS07KKMqxbGsmxzFMXp06TJKc+MtuMz1TZqcSoyenYDileJHLNBnJMhvNc2dy1TSGhJYsZyjKakk0ZjLOp3LwFeuGXHtIoq4DJs2WTZFotdU1uJ51NVm2Nq+TF+AznPNk1OyhFUFHHilZTVo1Cy5V43pFGp26TwHD0nLTdVjryBYsbtJnKOWMlGmiqaYo5KUZp6uA7bGeAzc35lbweN7Nt5lr4DROJ8zY7eD6/j9R4Hx+hznge5nx81SaiapseU1WjVVGc4rLifBZhrey6XJnM+I6BLWruX3ijhNWyqnotnkM5R4Do8teIyUcDZxHCbXLa6Z6lRyPuZcsXp3TPOA3arJ1pVG4Yro3AY1ilmr04zwE+qnRykUlIbCTOdBMioM5xwyGUlzngPUXAdIuCz6+U38H6GP8BsM5xFTlGXgNVy13KqRcB4GP4jnUp4TYJzIUbzwGirEMp0ySqRcFyOiaZnvAaFIcbKJRNRkJJmMhJJLKJRJJJJKJUhnMhkJNRxGVmU4jmi4Djssk2Sy9Xm85LisuNcBJnGO25ZJTOrpuAxrg9YlxB2vdLNZnskN9kmcUVTZRRjyWncB6llylcrnpx11yzVVTUUT08BiZzfJauD4b/xk+wZBx/cz8Bry5ZXc52PF8/tBrPAZUc/OvnXuF2LkvL/+rbs14DcP/W/ch'));
const TABLE_L1 = decode2(bytes_from_base64('0HGuA0LZcX4DfjPmHBZS+E+qbEaDTkmovgLxiHA5UMgz/gOBybgfi47IZuc57iMSyvhe/T1rc6Og6vInw2LaI+CxOeTFKnnnAeTR3GwUTZBVRkFFGQUTZBjVGgcBwk3e+vNVPZJu2/urGZOK0Dgunp4rvdNxrYBjQ4blsw9fHuE4d9r7Im4D2i+A9M1TDFeAzDFJdrnescBrj4DI3LiW7Td9/EkuUKbFBJd+/46h3WO+d8j5unguak9P4uA0ur383nxrYpsaGVTfBqUkuUKbFK33+kibgPaL4D0zVM5uAzBTWKaxOyyTn+64Pk8o/86L2HAUZJwHwcBjlfAf8b8YM+QcD0b/88RsvCaPmf/nluA4vbcg5fgPVGQf+Mr8D5cgxr/1rm+jGgMaAnBxLEBjV4xoWyY0aKhJkbnuNeIDGsdGNByTKiwz4kcayNyTGWqWfFDjWRjGgMaAxoDGgMaAxoDGgMaAxoDGgMaAxoSYjw2QGfJDiORmfJJ8RyMz5IcRyMz5JPiORmfJDiORmfJJ8RyMz5IcRyMz5JPiORmfJDiORmfJK6uG6UVAVAVAVDkOAyL/3qWycJtEn/vRs9xyQa61jrHBLGuL0Xismq2H'));
const TABLE_L2 = bytes_from_base64('gIAwgYIJBnICCBABLhIBBl4hBk4nEFoBEiIIKDQCElQSCkiBCBiCpHAigJAINlQBDm4BYB6YUIAWseAKYIDAWQiA4IyGBpmuE2Qy+Nwu/wB0ABIcgACABg6AxAI+IA4KgBgOFDAKEDw=');
const TABLE_M = [decode2(bytes_from_base64('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')),decode2(bytes_from_base64('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')),decode2(bytes_from_base64('4DPNi7/pu/58y9/03f9GV3/Rd/z/HZzz2+cAceWzcA8e5DO+g+QBzAcBtXfnHbsarpy7FeAt7/pu/5k19/03f8qr+/6bv+hJ7/pO/6Evv+m7/nTL3/Sd/zpff9F3/Ok9/0Hf86Z+/6bv+bJ7/nu/5s09/03f8uae/6Lv+XMvf893/Lk9/zXf8vJsQEmNYyJcex0TgCTGsZEuPY6Ltx7/qO/6HgMk8PcAHMBx/QeF/dGO7zs5/8admB/8adlo/8adlx/8adlq/8adli/8ab4uNYqqsQx/NPf/zgM0yFcBbwGPbGc1m4DFHwGI8BiW5nHeAyTNztNvAWPe+AVh4C3gLspWv51sU/AYvuWIya7wGLcBKa9w0E5bwGJZ7Joe4bGa9w1U37xwEsuVYrUbtV0BY1q23vINJ3ibK8oxR5jjtxsybTTlmZbmdC0TgJzoWjbys6x7RVlWWamck0LITj+hYisp3PgLjjOa4wcexrd6NqzDZTm2YZCaeAn4DInfluoSYzq9Vfwdaf/Gw8kf/Gw8eP/Gw8gf/Gw8ev/Gw8cf/Gw8fJ/42HjD/42Hj5v/Gw8Uf/Gw8fR/42HiD/42Hj6v/Gw8Mf/Gw8fZ/42HhD/42Hj7v/Gw8Ef/Gw8fiH/jYeAP/jYeNf/jYeSP/jYeNP/jYeQP/jYeNH/jYeOP/jYeNX/jYeMP/jYeNk/8bDxR/8bDkOIY60cikxvEt1OyYlud+wPFqTLkhxmnJDkqyQ14vkleMjdTsWKbqtyk3U7sNzOwYpua3CTczunheh4Xhu+rHTjE2OmzEsdORZDNkuITXuyeYqSV0CWXEvC77wvPOL+F9HhefVu5/8aX9R/8aX84/8aX9B/8aX86/8aX8x/8aX88n/jS/kP/jS/nm/8aX8R/8aX89H/jS/gP/jS/nq/8aX7x/8aX89n/jS/cP/jS/nu/8aX7R/8aX8+If+NL9g/+NL+V/+NL+o/+NL+U/+NL+g/+NL+Uf+NL+Y/+NL+Vf+NL+Q/+NL+WT/xpfxH/xpfyzf+NL+A/+NL+Wj/xpfvH/xpfy1f+NL9w/+NL+Wz/xpftH/xpfy3f+NL9g/+NL+OX/xpf1H/xpfxv/xpf0H/xpe914t/40fhKxMZRZlHFb1rNR1DWbOB0XgN8xyY5Dj0hyHIFrmmyZkc1mJcxLmzA5rRlxzXNsxLzbLzLm2Wl5ll5OZZeRmFRznMKDldZN1qNludHK8ky82ZJl5syTMTdkgOR5IDj94OIXg4hkAOQ25gchtzA5DfnhyvIstNmRZabMiByHIgcdxHODkt+XHHb8uON45l5xTHMvOKY4DjeOVHIcZzI4vjAOL4wDi+MUHHcWBxXFqjj+LUG/JcuM+S5cZZsvOVTAnLcwJy3OjXlucGnLwcwy8HMMry4nK8uJWXnLll5zDLycyy/MCMvzo05ijmGY5kRlrOZZblzGYyHMnmJzZgrMcwKzHODLmeZFZnmRWZ50ZTUZzQVSDVSDnNmcHP5M8OfyZ0c9ozg5/Rmxz3Nqjn+bUHOcyqOdrODnOZUHK6c2OT350crtzo5PiOdGvL88NaqIznOiM7zwimo0io3zVGfMc6N82XnLstzA4vjFRtkqM+Zo5hlucGvL8yLkBOX5kVmaJWdHOTnhpzHPDiNFR0OrOjbIDi+M5kcfyAHI6c4M+Z55lOU49wHOHgOfk4DnKOA7nHqv/Gp/P/7xbnsaxI5XjWKHLcaxY5fjWMHMcaxrWeAu4DJ8SPAYxwGU4keAxbgMnxQ8Bi3AZTinPfV/68PNfe8H3vEyT3vJFnAbl73efb2H29aT3e1d3s5Pebh3m2k+ttXrbOT/4Plf+D45Px/98f9k/+Lpv/FzJ8XEvFvJ+qb6n8=')),bytes_from_base64('n9e/5AAAAIB7v4G/pr+lARWADBkAABAaGQAAiBXDBAAAAIh0nG5eVmcBS4ASK2cBAoAiMW8CBE5QgAUED4AogCGAIgSAIXxLCgE5gAQFJAWAHXAKJAGAG3pVeAiAGXweXQQvIRZ4AmdmEoAFDEBYHwEGK2OAMmcKKnGAHlUGLHMWfAUbX3wMBCNpOFYBIzZnRgQBTQpGAwAiSyor7f6RtZ9p08gK/wByJQ8DFh8CwtDCw4ABHmLC5MLTB/8ASqyLADoABgE/ODUSASgvMCsBDB4VGAEnBCoHARUWDAUBAikiAgQngLaAyTo='),bytes_from_base64('sofg0CITgBplDjeAAHlyEQJlgAAEVwoCL3IRL1YBgAd4XS+AEgZvfGN2NwsdVoABcFUDGGMuHkYEK2eAEEsMAholFx+ACAIlUSB6IREZKndgGAMnFjNYIQwCDlUrgAJY4IEhBsLiwsM='),bytes_from_base64('spbg2oAAFzZnRoAZ4HEhBsLiwsOAAQ==')]; 
const TABLE_CM = decode2(bytes_from_base64('4LgNw4Dk5+A4fLSSiidIrzDFcQOyzqZIyZGcexvW686ppOMSGksy5W88oyrGDkObM4kZ6ljrzgmdJOk1LGinnBMsiTZx5M1vOCaCy8UWLTF5wTOknO6ljxzuVsyUnKJc3JnLMk6rWOvOCZyzJOq1jkmbozlmSk1LHXoxkmJNGJLPSp7KNiKprm0pY2SSZFmOKFS1nJKTsmKYvJIy1O5LbCapOCz98HmUmOPHVjy0DIKTlrJ3VZEd2sks4DW5c5qOOo5hj+Yy5fiOTU2PHrc4uzDFOAxhnFZDMU+A0bQOC1DIeL358BadgyDgeqm2lfrqkhqyBaguA5AsyHF5ZDqazLEsaxK05NRjNuWSZfdkh0O6w0LLXmRLSlROUyyrgNsoK87sDwWw4hiGIcHpp4DYjwGKy8NMypZMoch4DJVwPeycC1wGM15jJvTzW/KSlVJltc5z15JdiCyw2PMLqJCtcsmPAZBZismbozpJ0mpKdy8BoGJYudRxTgNrnVONrUsR2q3Zb+A4C/gN1mKUhJXAWzqdnHKsonMlBpry7EOBxWg0alixu3qZkozk6FKUZeA9uTy95lzufg+YJzeeTUTWvMytcj8OXLF+B56VzUUKfHpOAxR8PnebyZlQbji0pv4T0JziKnKMvAcLPwH7nPZOF2CfbZ//r5jNeA3D'));
const TABLE_V = bytes_from_base64('iM2AAIAAgACAAIAAgACAAG4BEX1wgACASoA1AYZaAR+AHoIOgGRmAUcBkQz6ByaAGIAPbYC2gHfd0oWHKg86egGADHWANWOAdYAAgH2AAHd1gI6AhAGAIlQTUoEmgIUBUg==');
const TABLE_LD = decode2(bytes_from_base64('4XoDKSTLJaZysjVGIYlkxVJJKyho4k5ZDSSSVj9bvUhKam0rIdWlRNRNRMiOOlS4lVKlMb+O744xrN2RE/+MQxXM/h82Wgy1F1ScBiJJbKJRxxcB6ORE8DxjOI2PHJFZlxKkKRRKMq/8az2miQ=='));
const TABLE_RD = decode2(bytes_from_base64('4XoCceNWRos6+TjCqaOIE49juZ6VkOq4zOTIZJcTZU2I2nG+O744xrN2RE/+MQxXMvh86Ykp0mpGaXgMQxLF5uA9LI+B4zFbJMbxLLiZTQZJF/41ntdE'));
const TABLE_T = decode2(bytes_from_base64('4DLTwPpbhwHJz8Bw+WklFE6RWTl2K4gdlnUyRkyEk49jet151TScYkNJZlyt55RlWMHIM3JMlEhc9Sx050ZJKDiixopZyZFIk2ceTNazkySlSHFFi0xOdFEyUGdVrHjnpsOZFnNyXKzJOq1jpzoozGVYoscWcqSSg4osdOkGdk60VPZRsRVNc2lLGySTm9xlKlrOSUnZpDMUljKkeISWlKY3ngs/fB5k8dWPLHloCM9BVdJy1k7qsiO7ORUmZ8BraRzomcklUTVI5hj+YyZgTKTKcopsWQSJF5wSmS86oS4DGGbTPIZi1wGjaBwPFlLGpcxllm2DIeL358BadgyDgeqk2tfrqkhqyBaguA5AsyHGVKeAxdY1iVpyajGa8ueYFSJZOdDmSSsNBy85mS0pUTlSoPAbcUZD53YHgthxDEMQ4DTzwG8vgeBPAbEeAxWXhpmVLJlDkPAZKuB72TgWuAxmvMZN7ObX5SUqnmMiU5z15JKaM+NizSmqRHX2iVMeAyAujFVnKZyWdy8BodCZOLnVJiZEVwG3STIrG1qtCJW1ElTE7K1IZeA4OkrgOARMh4DEJEpDkFWUTKSg0zJ5daVwOLTmYnUsWU5RW9TMlGcnSEyTwHtrlO7p7bN5c7n4PmDn8monzM4Rk5H3MuWL8D0DpxBT49JwGKPh87zeTMqDccWlN/CehOcRU5Rl4DhZ+A/c57JwuwT7bR/9fL5qce2DgBwG4Q=='));
const ZWNJ_EMOJI = decode_emoji(decode2(decode2(bytes_from_base64('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'))));

export const DEBUG = {TABLE_I, TABLE_D, TABLE_L1, TABLE_L2, TABLE_M, TABLE_CM, TABLE_V, TABLE_LD, TABLE_RD, TABLE_T, ZWNJ_EMOJI};

export function is_zwnj_emoji(v, pos) {
	let {length} = v;
	for (let b = Math.min(pos, ZWNJ_EMOJI.length); b > 0; b--) {
		let bucket = ZWNJ_EMOJI[b];
		if (!bucket) continue;
		next: for (let emoji of bucket) { // TODO: early abort 
			let i = pos - b;
			for (let c of emoji) {
				if (i >= length) continue next;
				let ci = v[i];			
				if (ci === 0xFE0F) { // this could be is_ignored()
					i++; // skip
					continue;
				} else if (c != v[i++]) {
					continue next;
				}
			}
			return true;
		}
	}
	return false;
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
// get_* returns list of code-points or undefined
export function is_disallowed(cp) {
	return lookup_member_span(TABLE_D, cp);
}
export function is_ignored(cp) {
	return lookup_member_span(TABLE_I, cp);
}
export function is_combining_mark(cp) {
    return lookup_member_span(TABLE_CM, cp);
}
export function get_mapped(cp) {
	let mapped = lookup_linear(TABLE_L1, 1, cp);
	if (mapped) return mapped;
	mapped = lookup_linear(TABLE_L2, 2, cp);
	if (mapped) return mapped;
	for (let i = 0; i < TABLE_M.length; i++) {	
		mapped = lookup_mapped(TABLE_M[i], i + 1, cp);
		if (mapped) return mapped;
	}
}

export class DisallowedLabelError extends Error {
	constructor(message, label) {
		super(`Disallowed label "${escape_unicode(label)}": ${message}`);
		this.label = label;
	}
}

export class DisallowedCharacterError extends Error {
	constructor(cp, i, desc = '') {
		super(`Disallowed character "${escape_unicode(String.fromCodePoint(cp))}" at position ${1+i}` + (desc ? `: ${desc}` : ''));
		this.codePoint = cp;
		this.offset = i;
	}
}

// expects a string 
// throws TypeError if not a string
// returns a string normalized according to IDNA 2008, according to UTS-46 (v14.0.0), +CONTEXTJ, +ZWJ EMOJI
export function idna(s, ignore_disallowed = false) {
	if (typeof s !== 'string') throw new TypeError('expected string');
	let v =  [...s].map(x => x.codePointAt(0)); // convert to code-points
	const empty = [];
	return String.fromCodePoint(...v.map((cp, i) => {
		if (is_disallowed(cp)) {
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp, i);
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
				while (head > 0 && lookup_member_span(TABLE_T, v[head])) head--; // T*
				if (lookup_member_span(TABLE_LD, v[head])) { // L or D
					let tail = i + 1;
					while (tail < v.length - 1 && lookup_member_span(TABLE_T, v[tail])) tail++; // T*
					if (lookup_member_span(TABLE_RD, v[tail])) { // R or D
						return cp; // allowed
					}
				}
			}
			if (ignore_disallowed) return empty;
			throw new DisallowedCharacterError(cp, i, `ZWJ outside of context`);
		} else if (cp === 0x200D) { // https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
			// rule 1: V + cp
			// V = Combining_Class "Virama"
			if (i > 0 && lookup_member(TABLE_V, v[i - 1])) { 
				return cp; // allowed
			}
			// custom rule: emoji
			if (is_zwnj_emoji(v, i)) {
				return cp; // allowed
			}
			if (ignore_disallowed) return empty; 
			throw new DisallowedCharacterError(cp, i, `ZWNJ outside of context`);
		}
		return get_mapped(cp) ?? cp;
	}).flat()).normalize('NFC');
}

// Primary API
// throws TypeError if not a string
// throws DisallowedLabelError/DisallowedCharacterError if not normalizable
// returns a string ready for namehash
export function ens_normalize(name, ignore_disallowed = false) { // https://unicode.org/reports/tr46/#Processing
	// Processing Rule #1 (Map) via idna()
	// Processing Rule #2 (Normalize) via idna()
	// Processing Rule #3 (Break)
	return idna(name, ignore_disallowed).split('.').map(label => { 
		// Processing Rule #4 (Convert)
		if (label.startsWith('xn--')) {			
			let s = puny_decode(label.slice(4));
			if (s != idna(s, true)) throw new DisallowedLabelError(`puny not idna`, label);
			label = s;
		}
		// Processing Rule #4 (Validate)
		// Section 4.1 Validity Criteria
		// https://unicode.org/reports/tr46/#Validity_Criteria
		// Rule #1 (NFC) via by idna()		
		// Rule #2
		if (/^.{2}--/u.test(label)) throw new DisallowedLabelError(`double-hyphen at position 3`, label);
		// Rule #3
		if (label.startsWith('-')) throw new DisallowedLabelError(`leading hyphen`, label);
		if (label.endsWith('-')) throw new DisallowedLabelError(`trailing hyphen`, label);		
		// Rule #4 (Stop) via idna()
		// Rule #5
		if (label.length > 0 && is_combining_mark(label.codePointAt(0))) throw new DisallowedLabelError(`leading combining mark`, label);
		// Rule #6 (Valid) via idna()
		// Rule #7 (ContextJ) via idna()
		// Rule #8 (Bidi) NYI
		return label;
	}).join('.');
}