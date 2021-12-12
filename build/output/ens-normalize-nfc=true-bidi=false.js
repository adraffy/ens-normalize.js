function arithmetic_decoder(e) {
    let A = 0;
    function g() {
        return e[A++] << 8 | e[A++];
    }
    var o = g();
    let r = 1, C = [ 0, 1 ];
    for (let A = 1; A < o; A++) C.push(r += g());
    var B = g();
    let Q = A;
    A += B;
    let E = 0, t = 0;
    function w() {
        return 0 == E && (t = t << 8 | e[A++], E += 8), t >> --E & 1;
    }
    var B = 2 ** 31, l = B >>> 1, D = B - 1;
    let a = 0;
    for (let A = 0; A < 31; A++) a = a << 1 | w();
    let s = [], i = 0, n = B;
    for (;;) {
        var I = Math.floor(((a - i + 1) * r - 1) / n);
        let A = 0, e = o;
        for (;1 < e - A; ) {
            var c = A + e >>> 1;
            I < C[c] ? e = c : A = c;
        }
        if (0 == A) break;
        s.push(A);
        let g = i + Math.floor(n * C[A] / r), B = i + Math.floor(n * C[A + 1] / r) - 1;
        for (;0 == ((g ^ B) & l); ) a = a << 1 & D | w(), g = g << 1 & D, B = B << 1 & D | 1;
        for (;g & ~B & 536870912; ) a = a & l | a << 1 & D >>> 1 | w(), g = g << 1 ^ l, 
        B = (B ^ l) << 1 | l | 1;
        i = g, n = 1 + B - g;
    }
    let N = o - 4;
    return s.map(A => {
        switch (A - N) {
          case 3:
            return 65792 + N + (e[Q++] << 16 | e[Q++] << 8 | e[Q++]);

          case 2:
            return 256 + N + (e[Q++] << 8 | e[Q++]);

          case 1:
            return N + e[Q++];

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
        let g = Array(e);
        for (let A = 0; A < e; A++) g[A] = 1 + this.read();
        return g;
    }
    read_ascending(g) {
        let B = Array(g);
        for (let A = 0, e = -1; A < g; A++) B[A] = e += 1 + this.read();
        return B;
    }
    read_deltas(g) {
        let B = Array(g);
        for (let A = 0, e = 0; A < g; A++) B[A] = e += this.read_signed();
        return B;
    }
    read_member_tables(e) {
        let g = [];
        for (let A = 0; A < e; A++) g.push(this.read_member_table());
        return g;
    }
    read_member_table() {
        let A = this.read_ascending(this.read());
        var e = this.read();
        let g = this.read_ascending(e), B = this.read_counts(e);
        return [ ...A.map(A => [ A, 1 ]), ...g.map((A, e) => [ A, B[e] ]) ].sort((A, e) => A[0] - e[0]);
    }
    read_mapped_table() {
        let A = [];
        for (;;) {
            var e = this.read();
            if (0 == e) break;
            A.push(this.read_linear_table(e));
        }
        for (;;) {
            var g = this.read() - 1;
            if (g < 0) break;
            A.push(this.read_mapped_replacement(g));
        }
        return A.flat().sort((A, e) => A[0] - e[0]);
    }
    read_ys_transposed(g, e) {
        let B = [ this.read_deltas(g) ];
        for (let A = 1; A < e; A++) {
            let e = Array(g);
            var o = B[A - 1];
            for (let A = 0; A < g; A++) e[A] = o[A] + this.read_signed();
            B.push(e);
        }
        return B;
    }
    read_mapped_replacement(A) {
        var e = 1 + this.read();
        let g = this.read_ascending(e), B = this.read_ys_transposed(e, A);
        return g.map((A, e) => [ A, B.map(A => A[e]) ]);
    }
    read_linear_table(A) {
        let g = 1 + this.read(), B = this.read();
        var e = 1 + this.read();
        let o = this.read_ascending(e), r = this.read_counts(e), C = this.read_ys_transposed(e, A);
        return o.map((A, e) => [ A, C.map(A => A[e]), r[e], g, B ]);
    }
    read_emoji() {
        let o = [];
        for (let A = this.read(); 0 < A; A--) {
            var r = 1 + this.read();
            let e = 1 + this.read();
            var C, Q = 1 + this.read();
            let g = [], B = [];
            for (let A = 0; A < r; A++) B.push([]);
            for (let A = 0; A < e; A++) Q & 1 << A - 1 ? (e++, g.push(A), B.forEach(A => A.push(8205))) : this.read_deltas(r).forEach((A, e) => B[e].push(A));
            for (C of g) {
                let A = o[C];
                A || (o[C] = A = []), A.push(...B);
            }
        }
        return o;
    }
}

function lookup_mapped(r, C) {
    for (let [ A, g, e, B, o ] of r) {
        var Q = C - A;
        if (Q < 0) break;
        if (0 < e) {
            if (Q < B * e && Q % B == 0) {
                let e = Q / B;
                return g.map(A => A + e * o);
            }
        } else if (0 == Q) return g;
    }
}

function lookup_member(A, e) {
    for (var [ g, B ] of A) {
        g = e - g;
        if (g < 0) break;
        if (g < B) return !0;
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

const S0 = 44032, L0 = 4352, V0 = 4449, T0 = 4519, L_COUNT = 19, V_COUNT = 21, T_COUNT = 28, N_COUNT = V_COUNT * T_COUNT, S_COUNT = L_COUNT * N_COUNT, S1 = S0 + S_COUNT, L1 = L0 + L_COUNT, V1 = V0 + V_COUNT, T1 = T0 + T_COUNT;

function is_hangul(A) {
    return A >= S0 && A < S1;
}

function decompose(A, e) {
    if (A < 128) e(A); else if (is_hangul(A)) {
        var g = A - S0, B = g / N_COUNT | 0, o = g % N_COUNT / T_COUNT | 0, g = g % T_COUNT;
        e(L0 + B), e(V0 + o), 0 < g && e(T0 + g);
    } else {
        g = lookup_mapped(DECOMP, A);
        if (g) for (var r of g) decompose(r, e); else e(A);
    }
}

function compose_pair(A, e) {
    if (A >= L0 && A < L1 && e >= V0 && e < V1) {
        var g = A - L0, B = e - V0, B = g * N_COUNT + B * T_COUNT;
        return S0 + B;
    }
    if (is_hangul(A) && e > T0 && e < T1 && (A - S0) % T_COUNT == 0) return A + (e - T0);
    for (var [ o, r ] of DECOMP) if (2 == r.length && r[0] == A && r[1] == e) {
        if (lookup_member(COMP_EXCLUSIONS, o)) break;
        return o;
    }
    return -1;
}

function decomposer(A, g) {
    let B = [];
    function o() {
        B.sort((A, e) => A[0] - e[0]).forEach(([ A, e ]) => g(A, e)), B.length = 0;
    }
    function e(e) {
        var A = 1 + COMBINING_RANK.findIndex(A => lookup_member(A, e));
        0 == A ? (o(), g(A, e)) : B.push([ A, e ]);
    }
    A.forEach(A => decompose(A, e)), o();
}

function nfd(A) {
    let g = [];
    return decomposer(A, (A, e) => g.push(e)), g;
}

function nfc(A) {
    let B = [], o = [], r = -1, C = 0;
    return decomposer(A, function(A, e) {
        var g;
        -1 === r ? 0 == A ? r = e : B.push(e) : 0 < C && C >= A ? (0 == A ? (B.push(r, ...o), 
        o.length = 0, r = e) : o.push(e), C = A) : 0 <= (g = compose_pair(r, e)) ? r = g : 0 == C && 0 == A ? (B.push(r), 
        r = e) : (o.push(e), C = A);
    }), 0 <= r && B.push(r), B.push(...o), B;
}

function puny_decode(B) {
    let g = [], o = B.lastIndexOf(45);
    for (let A = 0; A < o; A++) {
        var e = B[A];
        if (128 <= e) throw new Error("expected ASCII");
        g.push(e);
    }
    o++;
    let r = 0, C = 128, Q = 72;
    for (;o < B.length; ) {
        var E = r;
        for (let e = 1, g = 36; ;g += 36) {
            if (o >= B.length) throw new Error("invalid encoding");
            let A = B[o++];
            if (48 <= A && A <= 57) A -= 22; else {
                if (!(97 <= A && A <= 122)) throw new Error("invalid character " + A);
                A -= 97;
            }
            r += A * e;
            var t = g <= Q ? 1 : g >= Q + 26 ? 26 : g - Q;
            if (A < t) break;
            e *= 36 - t;
        }
        var w = g.length + 1;
        let A = 0 == E ? r / 700 | 0 : r - E >> 1;
        A += A / w | 0;
        let e = 0;
        for (;455 < A; e += 36) A = A / 35 | 0;
        Q = e + 36 * A / (A + 38) | 0, C += r / w | 0, r %= w, g.splice(r++, 0, C);
    }
    return g;
}

function is_zwnj_emoji(g, B) {
    var o = g.length;
    for (let e = Math.min(B, ZWNJ_EMOJI.length); 0 < e; e--) {
        var A = ZWNJ_EMOJI[e];
        if (A) A: for (var r of A) {
            let A = B - e;
            for (var C of r) {
                if (A >= o) continue A;
                if (65039 !== g[A]) {
                    if (C != g[A++]) continue A;
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

function nfc_idna_contextj_emoji(B, A = !1) {
    const o = [];
    return nfc(B.map((e, g) => {
        if (is_disallowed(e)) {
            if (A) return o;
            throw new DisallowedCharacterError(e);
        }
        if (is_ignored(e)) return o;
        if (8204 === e) {
            if (0 < g && lookup_member(VIRAMA, B[g - 1])) return e;
            if (0 < g && g < B.length - 1) {
                let A = g - 1;
                for (;0 < A && lookup_member(JOIN_T, B[A]); ) A--;
                if (lookup_member(JOIN_LD, B[A])) {
                    let A = g + 1;
                    for (;A < B.length - 1 && lookup_member(JOIN_T, B[A]); ) A++;
                    if (lookup_member(JOIN_RD, B[A])) return e;
                }
            }
            if (A) return o;
            throw new DisallowedCharacterError(e, "ZWJ outside of context");
        }
        if (8205 !== e) return lookup_mapped(MAPPED, e) ?? e;
        if (0 < g && lookup_member(VIRAMA, B[g - 1])) return e;
        if (is_zwnj_emoji(B, g)) return e;
        if (A) return o;
        throw new DisallowedCharacterError(e, "ZWNJ outside of context");
    }).flat());
}

function ens_normalize(A, e = !1, g = !0) {
    var B;
    let o = split(nfc_idna_contextj_emoji([ ...A ].map(A => A.codePointAt(0), e)), 46).map(e => {
        if (4 <= e.length && 45 == e[2] && 45 == e[3] && 120 == e[0] && 110 == e[1]) {
            let A;
            try {
                A = puny_decode(e.slice(4));
            } catch (A) {
                throw new DisallowedLabelError("punycode: " + A.message, e);
            }
            let g = nfc_idna_contextj_emoji(A, !0);
            if (A.length != g.length || !A.every((A, e) => A == g[e])) throw new DisallowedLabelError("puny not idna", e);
            e = A;
        }
        return e;
    });
    for (B of o) if (0 != B.length) {
        if (4 <= B.length && 45 == B[2] && 45 == B[3]) throw new DisallowedLabelError("invalid label extension", B);
        if (45 == B[0]) throw new DisallowedLabelError("leading hyphen", B);
        if (45 == B[B.length - 1]) throw new DisallowedLabelError("trailing hyphen", B);
        if (lookup_member(COMBINING_MARKS, B[0])) throw new DisallowedLabelError("leading combining mark", B);
    }
    if (g && o.some(A => A.some(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A)))) for (var r of o) if (0 != r.length) if (lookup_member(BIDI.R_AL, r[0])) {
        if (!r.every(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi RTL: disallowed properties", r);
        let A = r.length - 1;
        for (;lookup_member(BIDI.NSM, r[A]); ) A--;
        if (A = r[A], !(lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.AN, A))) throw new DisallowedLabelError("bidi RTL: disallowed ending", r);
        var C = r.some(A => lookup_member(BIDI.EN, A)), Q = r.some(A => lookup_member(BIDI.AN, A));
        if (C && Q) throw new DisallowedLabelError("bidi RTL: AN+EN", r);
    } else {
        if (!lookup_member(BIDI.L, r[0])) throw new DisallowedLabelError("bidi without direction", r);
        {
            if (!r.every(A => lookup_member(BIDI.L, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi LTR: disallowed properties", r);
            let A = r.length - 1;
            for (;lookup_member(BIDI.NSM, r[A]); ) A--;
            if (A = r[A], !lookup_member(BIDI.L, A) && !lookup_member(BIDI.EN, A)) throw new DisallowedLabelError("bidi LTR: disallowed ending", r);
        }
    }
    return o.map(A => str_from_cp(...A)).join(str_from_cp(46));
}

function split(A, e) {
    let g = [], B = 0;
    for (;;) {
        var o = A.indexOf(e, B);
        if (-1 == o) break;
        g.push(A.slice(B, o)), B = o + 1;
    }
    return g.push(A.slice(B)), g;
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