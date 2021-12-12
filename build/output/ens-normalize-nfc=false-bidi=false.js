function arithmetic_decoder(e) {
    let A = 0;
    function r() {
        return e[A++] << 8 | e[A++];
    }
    var t = r();
    let l = 1, i = [ 0, 1 ];
    for (let A = 1; A < t; A++) i.push(l += r());
    var o = r();
    let n = A;
    A += o;
    let w = 0, a = 0;
    function C() {
        return 0 == w && (a = a << 8 | e[A++], w += 8), a >> --w & 1;
    }
    var o = 2 ** 31, Q = o >>> 1, s = o - 1;
    let B = 0;
    for (let A = 0; A < 31; A++) B = B << 1 | C();
    let d = [], g = 0, f = o;
    for (;;) {
        var c = Math.floor(((B - g + 1) * l - 1) / f);
        let A = 0, e = t;
        for (;1 < e - A; ) {
            var E = A + e >>> 1;
            c < i[E] ? e = E : A = E;
        }
        if (0 == A) break;
        d.push(A);
        let r = g + Math.floor(f * i[A] / l), o = g + Math.floor(f * i[A + 1] / l) - 1;
        for (;0 == ((r ^ o) & Q); ) B = B << 1 & s | C(), r = r << 1 & s, o = o << 1 & s | 1;
        for (;r & ~o & 536870912; ) B = B & Q | B << 1 & s >>> 1 | C(), r = r << 1 ^ Q, 
        o = (o ^ Q) << 1 | Q | 1;
        g = r, f = 1 + o - r;
    }
    let m = t - 4;
    return d.map(A => {
        switch (A - m) {
          case 3:
            return 65792 + m + (e[n++] << 16 | e[n++] << 8 | e[n++]);

          case 2:
            return 256 + m + (e[n++] << 8 | e[n++]);

          case 1:
            return m + e[n++];

          default:
            return A - 1;
        }
    });
}

const VERSION = "1.2.0", UNICODE = "14.0.0";

class Decoder {
    constructor(A) {
        this.pos = 0, this.values = A;
    }
    read() {
        return this.values[this.pos++];
    }
    read_signed() {
        var A = this.read();
        return 1 & A ? ~A >> 1 : A >> 1;
    }
    read_counts(e) {
        let r = Array(e);
        for (let A = 0; A < e; A++) r[A] = 1 + this.read();
        return r;
    }
    read_ascending(r) {
        let o = Array(r);
        for (let A = 0, e = -1; A < r; A++) o[A] = e += 1 + this.read();
        return o;
    }
    read_deltas(r) {
        let o = Array(r);
        for (let A = 0, e = 0; A < r; A++) o[A] = e += this.read_signed();
        return o;
    }
    read_member_tables(e) {
        let r = [];
        for (let A = 0; A < e; A++) r.push(this.read_member_table());
        return r;
    }
    read_member_table() {
        let A = this.read_ascending(this.read());
        var e = this.read();
        let r = this.read_ascending(e), o = this.read_counts(e);
        return [ ...A.map(A => [ A, 1 ]), ...r.map((A, e) => [ A, o[e] ]) ].sort((A, e) => A[0] - e[0]);
    }
    read_mapped_table() {
        let A = [];
        for (;;) {
            var e = this.read();
            if (0 == e) break;
            A.push(this.read_linear_table(e));
        }
        for (;;) {
            var r = this.read() - 1;
            if (r < 0) break;
            A.push(this.read_mapped_replacement(r));
        }
        return A.flat().sort((A, e) => A[0] - e[0]);
    }
    read_ys_transposed(r, e) {
        let o = [ this.read_deltas(r) ];
        for (let A = 1; A < e; A++) {
            let e = Array(r);
            var t = o[A - 1];
            for (let A = 0; A < r; A++) e[A] = t[A] + this.read_signed();
            o.push(e);
        }
        return o;
    }
    read_mapped_replacement(A) {
        var e = 1 + this.read();
        let r = this.read_ascending(e), o = this.read_ys_transposed(e, A);
        return r.map((A, e) => [ A, o.map(A => A[e]) ]);
    }
    read_linear_table(A) {
        let r = 1 + this.read(), o = this.read();
        var e = 1 + this.read();
        let t = this.read_ascending(e), l = this.read_counts(e), i = this.read_ys_transposed(e, A);
        return t.map((A, e) => [ A, i.map(A => A[e]), l[e], r, o ]);
    }
    read_emoji() {
        let t = [];
        for (let A = this.read(); 0 < A; A--) {
            var l = 1 + this.read();
            let e = 1 + this.read();
            var i, n = 1 + this.read();
            let r = [], o = [];
            for (let A = 0; A < l; A++) o.push([]);
            for (let A = 0; A < e; A++) n & 1 << A - 1 ? (e++, r.push(A), o.forEach(A => A.push(8205))) : this.read_deltas(l).forEach((A, e) => o[e].push(A));
            for (i of r) {
                let A = t[i];
                A || (t[i] = A = []), A.push(...o);
            }
        }
        return t;
    }
}

function lookup_mapped(l, i) {
    for (let [ A, r, e, o, t ] of l) {
        var n = i - A;
        if (n < 0) break;
        if (0 < e) {
            if (n < o * e && n % o == 0) {
                let e = n / o;
                return r.map(A => A + e * t);
            }
        } else if (0 == n) return r;
    }
}

function lookup_member(A, e) {
    for (var [ r, o ] of A) {
        r = e - r;
        if (r < 0) break;
        if (r < o) return !0;
    }
    return !1;
}

function escape_unicode(A) {
    return A.replace(/[^\.\-a-z0-9]/giu, A => `{${A.codePointAt(0).toString(16).toUpperCase()}}`);
}

const str_from_cp = String.fromCodePoint;

let r = new Decoder(arithmetic_decoder(Uint8Array.from(atob("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"), A => A.charCodeAt(0)))), COMBINING_MARKS = r.read_member_table(), IGNORED = r.read_member_table(), DISALLOWED = r.read_member_table(), JOIN_T = r.read_member_table(), JOIN_LD = r.read_member_table(), JOIN_RD = r.read_member_table(), MAPPED = r.read_mapped_table(), ZWNJ_EMOJI = r.read_emoji(), COMBINING_RANK, VIRAMA, DECOMP, COMP_EXCLUSIONS;

VIRAMA = r.read_member_table();

let BIDI;

const S0 = 44032, L0 = 4352, V0 = 4449, T0 = 4519, L_COUNT = 19, V_COUNT = 21, T_COUNT = 28, N_COUNT = V_COUNT * T_COUNT, S_COUNT = L_COUNT * N_COUNT, S1 = S0 + S_COUNT, L1 = L0 + L_COUNT, V1 = V0 + V_COUNT, T1 = T0 + T_COUNT;

function is_hangul(A) {
    return A >= S0 && A < S1;
}

function decompose(A, e) {
    if (A < 128) e(A); else if (is_hangul(A)) {
        var r = A - S0, o = r / N_COUNT | 0, t = r % N_COUNT / T_COUNT | 0, r = r % T_COUNT;
        e(L0 + o), e(V0 + t), 0 < r && e(T0 + r);
    } else {
        r = lookup_mapped(DECOMP, A);
        if (r) for (var l of r) decompose(l, e); else e(A);
    }
}

function compose_pair(A, e) {
    if (A >= L0 && A < L1 && e >= V0 && e < V1) {
        var r = A - L0, o = e - V0, o = r * N_COUNT + o * T_COUNT;
        return S0 + o;
    }
    if (is_hangul(A) && e > T0 && e < T1 && (A - S0) % T_COUNT == 0) return A + (e - T0);
    for (var [ t, l ] of DECOMP) if (2 == l.length && l[0] == A && l[1] == e) {
        if (lookup_member(COMP_EXCLUSIONS, t)) break;
        return t;
    }
    return -1;
}

function decomposer(A, r) {
    let o = [];
    function t() {
        o.sort((A, e) => A[0] - e[0]).forEach(([ A, e ]) => r(A, e)), o.length = 0;
    }
    function e(e) {
        var A = 1 + COMBINING_RANK.findIndex(A => lookup_member(A, e));
        0 == A ? (t(), r(A, e)) : o.push([ A, e ]);
    }
    A.forEach(A => decompose(A, e)), t();
}

function nfd(A) {
    return [ ...str_from_cp(A).normalize("NFD") ].map(A => A.codePointAt(0));
}

function nfc(A) {
    return [ ...str_from_cp(A).normalize("NFC") ].map(A => A.codePointAt(0));
}

function puny_decode(o) {
    let r = [], t = o.lastIndexOf(45);
    for (let A = 0; A < t; A++) {
        var e = o[A];
        if (128 <= e) throw new Error("expected ASCII");
        r.push(e);
    }
    t++;
    let l = 0, i = 128, n = 72;
    for (;t < o.length; ) {
        var w = l;
        for (let e = 1, r = 36; ;r += 36) {
            if (t >= o.length) throw new Error("invalid encoding");
            let A = o[t++];
            if (48 <= A && A <= 57) A -= 22; else {
                if (!(97 <= A && A <= 122)) throw new Error("invalid character " + A);
                A -= 97;
            }
            l += A * e;
            var a = r <= n ? 1 : r >= n + 26 ? 26 : r - n;
            if (A < a) break;
            e *= 36 - a;
        }
        var C = r.length + 1;
        let A = 0 == w ? l / 700 | 0 : l - w >> 1;
        A += A / C | 0;
        let e = 0;
        for (;455 < A; e += 36) A = A / 35 | 0;
        n = e + 36 * A / (A + 38) | 0, i += l / C | 0, l %= C, r.splice(l++, 0, i);
    }
    return r;
}

function is_zwnj_emoji(r, o) {
    var t = r.length;
    for (let e = Math.min(o, ZWNJ_EMOJI.length); 0 < e; e--) {
        var A = ZWNJ_EMOJI[e];
        if (A) A: for (var l of A) {
            let A = o - e;
            for (var i of l) {
                if (A >= t) continue A;
                if (65039 !== r[A]) {
                    if (i != r[A++]) continue A;
                } else A++;
            }
            return !0;
        }
    }
    return !1;
}

function is_disallowed(A) {
    return lookup_member(DISALLOWED, A);
}

function is_ignored(A) {
    return lookup_member(IGNORED, A);
}

function get_mapped(A) {
    return lookup_mapped(MAPPED, A)?.slice();
}

class DisallowedLabelError extends Error {
    constructor(A, e) {
        super(`Disallowed label "${escape_unicode(str_from_cp(...e))}": ` + A), this.codePoints = e;
    }
}

class DisallowedCharacterError extends Error {
    constructor(A, e = "") {
        super(`Disallowed character "${escape_unicode(str_from_cp(A))}"` + (e ? ": " + e : "")), 
        this.codePoint = A;
    }
}

function nfc_idna_contextj_emoji(o, A = !1) {
    const t = [];
    return nfc(o.map((e, r) => {
        if (is_disallowed(e)) {
            if (A) return t;
            throw new DisallowedCharacterError(e);
        }
        if (is_ignored(e)) return t;
        if (8204 === e) {
            if (0 < r && lookup_member(VIRAMA, o[r - 1])) return e;
            if (0 < r && r < o.length - 1) {
                let A = r - 1;
                for (;0 < A && lookup_member(JOIN_T, o[A]); ) A--;
                if (lookup_member(JOIN_LD, o[A])) {
                    let A = r + 1;
                    for (;A < o.length - 1 && lookup_member(JOIN_T, o[A]); ) A++;
                    if (lookup_member(JOIN_RD, o[A])) return e;
                }
            }
            if (A) return t;
            throw new DisallowedCharacterError(e, "ZWJ outside of context");
        }
        if (8205 !== e) return lookup_mapped(MAPPED, e) ?? e;
        if (0 < r && lookup_member(VIRAMA, o[r - 1])) return e;
        if (is_zwnj_emoji(o, r)) return e;
        if (A) return t;
        throw new DisallowedCharacterError(e, "ZWNJ outside of context");
    }).flat());
}

function ens_normalize(A, e = !1, r = !0) {
    var o;
    let t = split(nfc_idna_contextj_emoji([ ...A ].map(A => A.codePointAt(0), e)), 46).map(e => {
        if (4 <= e.length && 45 == e[2] && 45 == e[3] && 120 == e[0] && 110 == e[1]) {
            let A;
            try {
                A = puny_decode(e.slice(4));
            } catch (A) {
                throw new DisallowedLabelError("punycode: " + A.message, e);
            }
            let r = nfc_idna_contextj_emoji(A, !0);
            if (A.length != r.length || !A.every((A, e) => A == r[e])) throw new DisallowedLabelError("puny not idna", e);
            e = A;
        }
        return e;
    });
    for (o of t) if (0 != o.length) {
        if (4 <= o.length && 45 == o[2] && 45 == o[3]) throw new DisallowedLabelError("invalid label extension", o);
        if (45 == o[0]) throw new DisallowedLabelError("leading hyphen", o);
        if (45 == o[o.length - 1]) throw new DisallowedLabelError("trailing hyphen", o);
        if (lookup_member(COMBINING_MARKS, o[0])) throw new DisallowedLabelError("leading combining mark", o);
    }
    if (r && t.some(A => A.some(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A)))) for (var l of t) if (0 != l.length) if (lookup_member(BIDI.R_AL, l[0])) {
        if (!l.every(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi RTL: disallowed properties", l);
        let A = l.length - 1;
        for (;lookup_member(BIDI.NSM, l[A]); ) A--;
        if (A = l[A], !(lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.AN, A))) throw new DisallowedLabelError("bidi RTL: disallowed ending", l);
        var i = l.some(A => lookup_member(BIDI.EN, A)), n = l.some(A => lookup_member(BIDI.AN, A));
        if (i && n) throw new DisallowedLabelError("bidi RTL: AN+EN", l);
    } else {
        if (!lookup_member(BIDI.L, l[0])) throw new DisallowedLabelError("bidi without direction", l);
        {
            if (!l.every(A => lookup_member(BIDI.L, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi LTR: disallowed properties", l);
            let A = l.length - 1;
            for (;lookup_member(BIDI.NSM, l[A]); ) A--;
            if (A = l[A], !lookup_member(BIDI.L, A) && !lookup_member(BIDI.EN, A)) throw new DisallowedLabelError("bidi LTR: disallowed ending", l);
        }
    }
    return t.map(A => str_from_cp(...A)).join(str_from_cp(46));
}

function split(A, e) {
    let r = [], o = 0;
    for (;;) {
        var t = A.indexOf(e, o);
        if (-1 == t) break;
        r.push(A.slice(o, t)), o = t + 1;
    }
    return r.push(A.slice(o)), r;
}

export {
    VERSION,
    UNICODE,
    nfd,
    nfc,
    is_disallowed,
    is_ignored,
    get_mapped,
    DisallowedLabelError,
    DisallowedCharacterError,
    ens_normalize
};