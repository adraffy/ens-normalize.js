function arithmetic_decoder(e) {
    let A = 0;
    function B() {
        return e[A++] << 8 | e[A++];
    }
    var r = B();
    let g = 1, Q = [ 0, 1 ];
    for (let A = 1; A < r; A++) Q.push(g += B());
    var o = B();
    let E = A;
    A += o;
    let C = 0, w = 0;
    function t() {
        return 0 == C && (w = w << 8 | e[A++], C += 8), w >> --C & 1;
    }
    var o = 2 ** 31, D = o >>> 1, l = o - 1;
    let s = 0;
    for (let A = 0; A < 31; A++) s = s << 1 | t();
    let i = [], n = 0, a = o;
    for (;;) {
        var I = Math.floor(((s - n + 1) * g - 1) / a);
        let A = 0, e = r;
        for (;1 < e - A; ) {
            var N = A + e >>> 1;
            I < Q[N] ? e = N : A = N;
        }
        if (0 == A) break;
        i.push(A);
        let B = n + Math.floor(a * Q[A] / g), o = n + Math.floor(a * Q[A + 1] / g) - 1;
        for (;0 == ((B ^ o) & D); ) s = s << 1 & l | t(), B = B << 1 & l, o = o << 1 & l | 1;
        for (;B & ~o & 536870912; ) s = s & D | s << 1 & l >>> 1 | t(), B = B << 1 ^ D, 
        o = (o ^ D) << 1 | D | 1;
        n = B, a = 1 + o - B;
    }
    let c = r - 4;
    return i.map(A => {
        switch (A - c) {
          case 3:
            return 65792 + c + (e[E++] << 16 | e[E++] << 8 | e[E++]);

          case 2:
            return 256 + c + (e[E++] << 8 | e[E++]);

          case 1:
            return c + e[E++];

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
        let B = Array(e);
        for (let A = 0; A < e; A++) B[A] = 1 + this.read();
        return B;
    }
    read_ascending(B) {
        let o = Array(B);
        for (let A = 0, e = -1; A < B; A++) o[A] = e += 1 + this.read();
        return o;
    }
    read_deltas(B) {
        let o = Array(B);
        for (let A = 0, e = 0; A < B; A++) o[A] = e += this.read_signed();
        return o;
    }
    read_member_tables(e) {
        let B = [];
        for (let A = 0; A < e; A++) B.push(this.read_member_table());
        return B;
    }
    read_member_table() {
        let A = this.read_ascending(this.read());
        var e = this.read();
        let B = this.read_ascending(e), o = this.read_counts(e);
        return [ ...A.map(A => [ A, 1 ]), ...B.map((A, e) => [ A, o[e] ]) ].sort((A, e) => A[0] - e[0]);
    }
    read_mapped_table() {
        let A = [];
        for (;;) {
            var e = this.read();
            if (0 == e) break;
            A.push(this.read_linear_table(e));
        }
        for (;;) {
            var B = this.read() - 1;
            if (B < 0) break;
            A.push(this.read_mapped_replacement(B));
        }
        return A.flat().sort((A, e) => A[0] - e[0]);
    }
    read_ys_transposed(B, e) {
        let o = [ this.read_deltas(B) ];
        for (let A = 1; A < e; A++) {
            let e = Array(B);
            var r = o[A - 1];
            for (let A = 0; A < B; A++) e[A] = r[A] + this.read_signed();
            o.push(e);
        }
        return o;
    }
    read_mapped_replacement(A) {
        var e = 1 + this.read();
        let B = this.read_ascending(e), o = this.read_ys_transposed(e, A);
        return B.map((A, e) => [ A, o.map(A => A[e]) ]);
    }
    read_linear_table(A) {
        let B = 1 + this.read(), o = this.read();
        var e = 1 + this.read();
        let r = this.read_ascending(e), g = this.read_counts(e), Q = this.read_ys_transposed(e, A);
        return r.map((A, e) => [ A, Q.map(A => A[e]), g[e], B, o ]);
    }
    read_emoji() {
        let r = [];
        for (let A = this.read(); 0 < A; A--) {
            var g = 1 + this.read();
            let e = 1 + this.read();
            var Q, E = 1 + this.read();
            let B = [], o = [];
            for (let A = 0; A < g; A++) o.push([]);
            for (let A = 0; A < e; A++) E & 1 << A - 1 ? (e++, B.push(A), o.forEach(A => A.push(8205))) : this.read_deltas(g).forEach((A, e) => o[e].push(A));
            for (Q of B) {
                let A = r[Q];
                A || (r[Q] = A = []), A.push(...o);
            }
        }
        return r;
    }
}

function lookup_mapped(g, Q) {
    for (let [ A, B, e, o, r ] of g) {
        var E = Q - A;
        if (E < 0) break;
        if (0 < e) {
            if (E < o * e && E % o == 0) {
                let e = E / o;
                return B.map(A => A + e * r);
            }
        } else if (0 == E) return B;
    }
}

function lookup_member(A, e) {
    for (var [ B, o ] of A) {
        B = e - B;
        if (B < 0) break;
        if (B < o) return !0;
    }
    return !1;
}

function escape_unicode(A) {
    return A.replace(/[^\.\-a-z0-9]/giu, A => `{${A.codePointAt(0).toString(16).toUpperCase()}}`);
}

const str_from_cp = String.fromCodePoint;

let r = new Decoder(arithmetic_decoder(Uint8Array.from(atob("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qjuwVaqACmM+jEZEUmlGPt8+4z7fPtk+1T7hPuE+3T7dPt0+3T7bPts+1z7XPtc+1z7hzHDMbsxsI1QzTCJFASMVRQAvOA0zRzkFE043JWIQ39Lf0N/O38zfyt/I38bfxN/C38Df0t/Q387fzN/KNTM1NTUzMzNCA0IPQg/KKsooyibKJMoiyiDKHsocyhrKGMoqyijKJsokyiLKIMoeyhzKGsoYyirKKNzcXgRs7TqnO61Vp4AHYzuMQ0RPaUMfF7oHVAezyOs/JD7BSkIqG65tPs49Ckg+5h5SYg5oPEQwOjwmGCMxMx8pDRD1QhBCJPY+5RYQYQsVcl48JwseqUIDQhMACScnL0ViOB04RScVPBYGBlMIQTHHF2AQX7NAQDI4PBYjJxE5HSNBUDcVWjIXNjALOiAYQiIlFlIVBkhCQgMx1lhgGl81QEIiJ0IDBkEC55AJkE2IApjEApjJApjECCgC55AJlALnkE2IApjIApjJApjKAufWCQgJAueQfgLnkAmQAqRvAphUAAQAnABgagOgtAmtCZACo5kCl94MApoF9gLnjAKaY6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKluQKlnAfbCWgCpmMCl4ICmI8ItgKb/gKjqwKcCAE/Ab9ycwLnkAmQAua2TYgCojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojIC55AJkALmth4C55AJkALmtk2IAufWAueQCZAC5rYCAgLyYgmRCZACpG8CmFQABACcAGBqA6C0CakJkALmtgLlyAKYnaQClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKX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"), A => A.charCodeAt(0)))), COMBINING_MARKS = r.read_member_table(), IGNORED = r.read_member_table(), DISALLOWED = r.read_member_table(), JOIN_T = r.read_member_table(), JOIN_LD = r.read_member_table(), JOIN_RD = r.read_member_table(), MAPPED = r.read_mapped_table(), ZWNJ_EMOJI = r.read_emoji(), COMBINING_RANK, VIRAMA, DECOMP, COMP_EXCLUSIONS;

COMBINING_RANK = r.read_member_tables(1 + r.read()), VIRAMA = COMBINING_RANK[r.read()], 
DECOMP = r.read_mapped_table(), COMP_EXCLUSIONS = r.read_member_table();

let BIDI;

BIDI = {
    R_AL: r.read_member_table(),
    L: r.read_member_table(),
    AN: r.read_member_table(),
    EN: r.read_member_table(),
    ECTOB: r.read_member_table(),
    NSM: r.read_member_table()
};

const S0 = 44032, L0 = 4352, V0 = 4449, T0 = 4519, L_COUNT = 19, V_COUNT = 21, T_COUNT = 28, N_COUNT = V_COUNT * T_COUNT, S_COUNT = L_COUNT * N_COUNT, S1 = S0 + S_COUNT, L1 = L0 + L_COUNT, V1 = V0 + V_COUNT, T1 = T0 + T_COUNT;

function is_hangul(A) {
    return A >= S0 && A < S1;
}

function decompose(A, e) {
    if (A < 128) e(A); else if (is_hangul(A)) {
        var B = A - S0, o = B / N_COUNT | 0, r = B % N_COUNT / T_COUNT | 0, B = B % T_COUNT;
        e(L0 + o), e(V0 + r), 0 < B && e(T0 + B);
    } else {
        B = lookup_mapped(DECOMP, A);
        if (B) for (var g of B) decompose(g, e); else e(A);
    }
}

function compose_pair(A, e) {
    if (A >= L0 && A < L1 && e >= V0 && e < V1) {
        var B = A - L0, o = e - V0, o = B * N_COUNT + o * T_COUNT;
        return S0 + o;
    }
    if (is_hangul(A) && e > T0 && e < T1 && (A - S0) % T_COUNT == 0) return A + (e - T0);
    for (var [ r, g ] of DECOMP) if (2 == g.length && g[0] == A && g[1] == e) {
        if (lookup_member(COMP_EXCLUSIONS, r)) break;
        return r;
    }
    return -1;
}

function decomposer(A, B) {
    let o = [];
    function r() {
        o.sort((A, e) => A[0] - e[0]).forEach(([ A, e ]) => B(A, e)), o.length = 0;
    }
    function e(e) {
        var A = 1 + COMBINING_RANK.findIndex(A => lookup_member(A, e));
        0 == A ? (r(), B(A, e)) : o.push([ A, e ]);
    }
    A.forEach(A => decompose(A, e)), r();
}

function nfd(A) {
    let B = [];
    return decomposer(A, (A, e) => B.push(e)), B;
}

function nfc(A) {
    let o = [], r = [], g = -1, Q = 0;
    return decomposer(A, function(A, e) {
        var B;
        -1 === g ? 0 == A ? g = e : o.push(e) : 0 < Q && Q >= A ? (0 == A ? (o.push(g, ...r), 
        r.length = 0, g = e) : r.push(e), Q = A) : 0 <= (B = compose_pair(g, e)) ? g = B : 0 == Q && 0 == A ? (o.push(g), 
        g = e) : (r.push(e), Q = A);
    }), 0 <= g && o.push(g), o.push(...r), o;
}

function puny_decode(o) {
    let B = [], r = o.lastIndexOf(45);
    for (let A = 0; A < r; A++) {
        var e = o[A];
        if (128 <= e) throw new Error("expected ASCII");
        B.push(e);
    }
    r++;
    let g = 0, Q = 128, E = 72;
    for (;r < o.length; ) {
        var C = g;
        for (let e = 1, B = 36; ;B += 36) {
            if (r >= o.length) throw new Error("invalid encoding");
            let A = o[r++];
            if (48 <= A && A <= 57) A -= 22; else {
                if (!(97 <= A && A <= 122)) throw new Error("invalid character " + A);
                A -= 97;
            }
            g += A * e;
            var w = B <= E ? 1 : B >= E + 26 ? 26 : B - E;
            if (A < w) break;
            e *= 36 - w;
        }
        var t = B.length + 1;
        let A = 0 == C ? g / 700 | 0 : g - C >> 1;
        A += A / t | 0;
        let e = 0;
        for (;455 < A; e += 36) A = A / 35 | 0;
        E = e + 36 * A / (A + 38) | 0, Q += g / t | 0, g %= t, B.splice(g++, 0, Q);
    }
    return B;
}

function is_zwnj_emoji(B, o) {
    var r = B.length;
    for (let e = Math.min(o, ZWNJ_EMOJI.length); 0 < e; e--) {
        var A = ZWNJ_EMOJI[e];
        if (A) A: for (var g of A) {
            let A = o - e;
            for (var Q of g) {
                if (A >= r) continue A;
                if (65039 !== B[A]) {
                    if (Q != B[A++]) continue A;
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
    const r = [];
    return nfc(o.map((e, B) => {
        if (is_disallowed(e)) {
            if (A) return r;
            throw new DisallowedCharacterError(e);
        }
        if (is_ignored(e)) return r;
        if (8204 === e) {
            if (0 < B && lookup_member(VIRAMA, o[B - 1])) return e;
            if (0 < B && B < o.length - 1) {
                let A = B - 1;
                for (;0 < A && lookup_member(JOIN_T, o[A]); ) A--;
                if (lookup_member(JOIN_LD, o[A])) {
                    let A = B + 1;
                    for (;A < o.length - 1 && lookup_member(JOIN_T, o[A]); ) A++;
                    if (lookup_member(JOIN_RD, o[A])) return e;
                }
            }
            if (A) return r;
            throw new DisallowedCharacterError(e, "ZWJ outside of context");
        }
        if (8205 !== e) return lookup_mapped(MAPPED, e) ?? e;
        if (0 < B && lookup_member(VIRAMA, o[B - 1])) return e;
        if (is_zwnj_emoji(o, B)) return e;
        if (A) return r;
        throw new DisallowedCharacterError(e, "ZWNJ outside of context");
    }).flat());
}

function ens_normalize(A, e = !1, B = !0) {
    var o;
    let r = split(nfc_idna_contextj_emoji([ ...A ].map(A => A.codePointAt(0), e)), 46).map(e => {
        if (4 <= e.length && 45 == e[2] && 45 == e[3] && 120 == e[0] && 110 == e[1]) {
            let A;
            try {
                A = puny_decode(e.slice(4));
            } catch (A) {
                throw new DisallowedLabelError("punycode: " + A.message, e);
            }
            let B = nfc_idna_contextj_emoji(A, !0);
            if (A.length != B.length || !A.every((A, e) => A == B[e])) throw new DisallowedLabelError("puny not idna", e);
            e = A;
        }
        return e;
    });
    for (o of r) if (0 != o.length) {
        if (4 <= o.length && 45 == o[2] && 45 == o[3]) throw new DisallowedLabelError("invalid label extension", o);
        if (45 == o[0]) throw new DisallowedLabelError("leading hyphen", o);
        if (45 == o[o.length - 1]) throw new DisallowedLabelError("trailing hyphen", o);
        if (lookup_member(COMBINING_MARKS, o[0])) throw new DisallowedLabelError("leading combining mark", o);
    }
    if (B && r.some(A => A.some(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A)))) for (var g of r) if (0 != g.length) if (lookup_member(BIDI.R_AL, g[0])) {
        if (!g.every(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi RTL: disallowed properties", g);
        let A = g.length - 1;
        for (;lookup_member(BIDI.NSM, g[A]); ) A--;
        if (A = g[A], !(lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.AN, A))) throw new DisallowedLabelError("bidi RTL: disallowed ending", g);
        var Q = g.some(A => lookup_member(BIDI.EN, A)), E = g.some(A => lookup_member(BIDI.AN, A));
        if (Q && E) throw new DisallowedLabelError("bidi RTL: AN+EN", g);
    } else {
        if (!lookup_member(BIDI.L, g[0])) throw new DisallowedLabelError("bidi without direction", g);
        {
            if (!g.every(A => lookup_member(BIDI.L, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi LTR: disallowed properties", g);
            let A = g.length - 1;
            for (;lookup_member(BIDI.NSM, g[A]); ) A--;
            if (A = g[A], !lookup_member(BIDI.L, A) && !lookup_member(BIDI.EN, A)) throw new DisallowedLabelError("bidi LTR: disallowed ending", g);
        }
    }
    return r.map(A => str_from_cp(...A)).join(str_from_cp(46));
}

function split(A, e) {
    let B = [], o = 0;
    for (;;) {
        var r = A.indexOf(e, o);
        if (-1 == r) break;
        B.push(A.slice(o, r)), o = r + 1;
    }
    return B.push(A.slice(o)), B;
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