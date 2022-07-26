function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

// my suggested inline ascii-safe unicode escape
// this is ES6 \u{X} without the \u
function quote_cp(cp) {
	return `{${hex_cp(cp)}}`;
}

function escape_unicode(s) {
	// printable w/o:
	// 0x20 (space)
	// 0x22 (double-quote)
	// 0x7B/0x7D (curly-brace, used for escaping)
	// 0x7F (delete)
	return s.replace(/[^\x21\x23-\x7A\x7C\x7E]/gu, x => quote_cp(x.codePointAt(0)));
}

// str to cps
function explode_cp(s) {
	if (typeof s != 'string') throw new TypeError(`expected string`);	
	return [...s].map(c => c.codePointAt(0));
}

// https://datatracker.ietf.org/doc/html/rfc3492

// formats:
// "{encoded}"
// "{lower-ascii}-{encoded}"

// overflow calculation:
// https://datatracker.ietf.org/doc/html/rfc3492#section-6.4
// max unicode = 0x10FFFF => 21 bits
// max safe int = 53 bits (same as string length)
// (32 - 21) => 11-bit label length => 2KB unsigned
// (53 - 21) => 32-bit label length => 4GB unsigned
// decision: use IEEE-754 math, ignore bounds check

// Bootstring for Punycode
// https://datatracker.ietf.org/doc/html/rfc3492#section-5
const BASE = 36; 
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const N = 128;
const BIAS = 72;

const SHIFT_BASE = BASE - T_MIN;
const MAX_DELTA = SHIFT_BASE * T_MAX >> 1;

const HYPHEN = 0x2D;

// 41..5A (A-Z) =  0 to 25, respectively
// 61..7A (a-z) =  0 to 25, respectively
// 30..39 (0-9) = 26 to 35, respectively

// An encoder SHOULD output only uppercase forms or only lowercase forms
// => lowercase
function cp_from_basic(x) {
	return x < 26 ? 97 + x : 22 + x;
}

function trim_bias(k, bias) {
	let delta = k - bias;
	return delta <= 0 ? T_MIN : delta >= T_MAX ? T_MAX : delta;
}

// https://datatracker.ietf.org/doc/html/rfc3492#section-6.1
function adapt(delta, n, first) {
	delta = Math.floor(delta / (first ? DAMP : 2));
	delta += Math.floor(delta / n);
	let k = 0;
	while (delta > MAX_DELTA) {
		delta = Math.floor(delta / SHIFT_BASE);
		k += BASE;
	}
	return k + Math.floor((1 + SHIFT_BASE) * delta / (delta + SKEW));
}

// https://datatracker.ietf.org/doc/html/rfc3492#section-6.3
// cps -> cps
// does not restrict ascii part
// does not append "xn--""
// returns unchanged if not required
function puny_encode(cps) {
	let ret = cps.filter(cp => cp < N);
	let basic = ret.length;
	if (basic == cps.length) return cps; // puny not needed
	//if (prefixed) ret.unshift(120, 110, HYPHEN, HYPHEN); // insert "xn--"
	if (basic) ret.push(HYPHEN);
	let cp0 = N;
	let bias = BIAS;
	let delta = 0;
	let pos = basic;
	while (pos < cps.length) {
		//let cp1 = Math.min(...cps.filter(cp => cp >= cp0));
		let cp1 = cps.reduce((min, cp) => cp >= cp0 && cp < min ? cp : min, Infinity);
		delta += (cp1 - cp0) * (pos + 1);
		for (let cp of cps) {
			if (cp < cp1) {
				delta++;
			} else if (cp == cp1) {
				let q = delta;
				for (let k = BASE; ; k += BASE) {
					let t = trim_bias(k, bias);
					let q_t = q - t;
					if (q_t < 0) break;
					let base_t = BASE - t;
					ret.push(cp_from_basic(t + (q_t % base_t)));
					q = Math.floor(q_t / base_t);
				}
				ret.push(cp_from_basic(q));
				bias = adapt(delta, pos + 1, pos == basic);
				delta = 0;
				pos++;
			}
		}
		delta++;
		cp0 = cp1 + 1;
	}
	return ret;
}

var VALID_STR = "-.0123456789abcdefghijklmnopqrstuvwxyz";

// https://en.wikipedia.org/wiki/Domain_Name_System

// lower-ascii characters valid in IDNA 2003/2008
const VALID = new Set(explode_cp(VALID_STR));

// [len, 63][len, 63][len, 63][len, 61][len, 0] = 255 
// 63+1+63+1+63+1+61 = 253
const MAX_NAME = 253; 
const MAX_LABEL = 63;

function label_error(s, message) {
	return new Error(`Invalid label "${escape_unicode(s)}": ${message}`);
}

// assume: name is from ens_normalize()
function dns_from_normalized_ens(name) {	
	let acc = 0;
	return name.split('.').map((label, i) => {
		if (i > 0) acc++; // separator
		if (!label) return ''; // empty label
		if (/^xn--/i.test(label)) throw label_error(label, `literal punycode`);
		if (label.startsWith('-')) throw label_error(label, 'leading hyphen');
		if (label.endsWith('-')) throw label_error(label, 'trailing hyphen');
		let cps = explode_cp(label);
		let encoded = puny_encode(cps);
		if (encoded.length > MAX_LABEL) throw label_error(label, `too long`);
		for (let cp of encoded) {
			if (!VALID.has(cp)) {
				throw label_error(label, `invalid ASCII: "${escape_unicode(String.fromCodePoint(cp))}"`);
			}
		}
		if (encoded.some(cp => !VALID.has(cp))) 
		acc += encoded.length;
		if (acc > MAX_NAME) throw new Error(`Name too long`);
		return encoded === cps ? label : 'xn--' + String.fromCodePoint(...encoded);
	}).join('.');
}

export { dns_from_normalized_ens };
