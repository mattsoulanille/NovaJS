/**
 * Bible-accurate conditional text for dësc resources, per the EVN Bible's
 * "The dësc resource" section:
 *
 *   If you wish, you can make a dësc resource mutable via control bits -
 *   embedding a special sequence of characters into the dësc resource will
 *   instruct Nova to change the contents of the text on the fly. This
 *   sequence is delimited (marked) by the characters "{" and "}", and
 *   follows this format:
 *
 *       {bXXX "string one" "string two"}
 *
 * The test may be negated with a leading "!", and — unlike the ncb set
 * language used by availability fields — a dësc test is a SINGLE term:
 * no compound (multiple-bit) tests. The supported terms are bXXX (a control
 * bit), G (gender) and P/Pxxx (registered status). When the test is true
 * the first string is substituted for the whole "{...}" block; when false,
 * the second string (if present) is substituted, and if there is no second
 * string nothing is substituted. A quote inside a string is escaped with a
 * backslash ("\").
 *
 * Real stock data ("Nova Files") uses exactly these three terms: {bXXX ...}
 * control-bit text, {G "he" "she"} gender text, and {P30 "." ".
 * REQUIRES YOU TO REGISTER EV NOVA"} registration text (the P term may omit
 * the trailing days, e.g. {P "paid" "unpaid"}). No outrofit/explored
 * Oxxx/Exxx terms appear in real dësc data, and none of the 227 stock
 * STR# tables use the "{...}" conditional syntax at all — this mechanism is a
 * dësc-only feature in practice.
 *
 * This module is display-side only: it reads control bits and pilot identity,
 * never mutates simulation state.
 */
import { loadPilotProfile } from '../../title/client_prefs.js';
import {
    evaluateParsedNCBTest,
    NCBTestContext,
    parseNCBTest,
} from './ncb.js';

/**
 * NovaJS ships without a registration system (there is no paid copy to
 * detect), so the original's "registered" test term (P / Pxxx) is
 * pinned here. `true` matches the original's behaviour once the game has been
 * purchased — the "please register" nag strings in stock dëscs (e.g.
 * outfit dësc 3031) resolve to their polite first-string variant. Tune this
 * single switch to flip every registered-conditional in the game at once.
 */
export const IS_REGISTERED = true;

/**
 * The active pilot's gender, for dësc gender conditionals. Reads the
 * current client pilot profile ('male'/'female'); with no profile the pilot
 * defaults to male (the ncb evaluator's G default). Supply `gender` to
 * override (tests, or a module that already holds the profile).
 */
export function playerGender(gender?: string): string {
    if (gender !== undefined) {
        return gender;
    }
    return loadPilotProfile()?.gender ?? 'male';
}

/**
 * Builds the NCB evaluation context a dësc conditional is tested against.
 * `bits` is the player's real control-bit set (a display read); `gender`
 * is the active pilot's 'male'/'female' profile gender (any non-'female'
 * value — including "no pilot profile chosen" — is treated as male, matching
 * the ncb evaluator's male default).
 */
export function makeDescTextContext(bits: ReadonlySet<number> | Iterable<number>,
    gender?: string): NCBTestContext {
    const bitSet = bits instanceof Set ? bits : new Set(bits);
    return {
        getBit: bit => bitSet.has(bit),
        isMale: playerGender(gender) !== 'female',
        isRegistered: IS_REGISTERED,
    };
}

/**
 * The empty context, for call sites that only need to exercise the parser
 * (tests) or where no real bits/identity are available yet. Reads nothing,
 * defaults male + registered, and reports every bit as clear.
 */
export function emptyDescTextContext(): NCBTestContext {
    return makeDescTextContext(new Set());
}

/**
 * Parses the single-term test that appears inside a dësc conditional,
 * "bXXX" / "!bXXX" / "G" / "!G" / "P[xxx]" / "!P[xxx]".
 *
 * Reuses {@link parseNCBTest} (the one ncb test parser) directly. The
 * one wrinkle the Bible allows but that parser doesn't spell out is a bare
 * "P" with no day count; register "p" -> "p0" so it flows through the
 * same term as "Pxxx". Malformed tests silently return `null` so the caller
 * degrades to the literal block rather than throwing user-visible errors.
 */
function parseDescConditionalTest(raw: string): ReturnType<typeof parseNCBTest> | null {
    let test = raw.trim();
    if (test.length === 0) {
        return null;
    }
    const negated = test[0] === '!';
    const body = negated ? test.slice(1) : test;
    if (/^p$/i.test(body)) {
        test = (negated ? '!' : '') + 'p0';
    } else if (!/^(?:[bg]\d*|p\d+)$/i.test(body)) {
        // Not a recognized dësc test term (no compound Oxxx/Exxx/
        // operators are legal in this context per the Bible).
        return null;
    }
    try {
        return parseNCBTest(test);
    } catch {
        return null;
    }
}

/**
 * Reads a quoted string (with "\" escapes) starting at `text[pos]` (which
 * must be '"'), consuming the closing quote. Returns the unescaped string and
 * the new position, or `null` if the string isn't terminated.
 */
function readQuotedString(text: string, pos: number): { value: string, pos: number } | null {
    let value = '';
    pos += 1; // the opening quote
    while (pos < text.length) {
        const c = text[pos];
        if (c === '\\' && pos + 1 < text.length) {
            value += text[pos + 1];
            pos += 2;
            continue;
        }
        if (c === '"') {
            return { value, pos: pos + 1 };
        }
        value += c;
        pos += 1;
    }
    return null; // unterminated
}

/**
 * Attempts to parse a complete conditional block starting at `text[start]`
 * (which must be "{"). Returns the substituted string and the index just past
 * the closing "}", or `null` if the text isn't a well-formed conditional —
 * in which case the caller leaves the "{" literal. The Bible documents no
 * nesting of conditionals, so a chosen string is substituted verbatim (any
 * further "{...}" in it is passed through untouched).
 */
function tryParseConditional(text: string, start: number,
    ctx: NCBTestContext): { result: string, end: number } | null {
    let pos = start + 1;

    const skipWs = () => {
        while (pos < text.length && /\s/.test(text[pos])) {
            pos += 1;
        }
    };

    skipWs();
    // The test term: optional "!", then one of b/G/P with optional digits.
    let test = '';
    if (text[pos] === '!') {
        test += '!';
        pos += 1;
    }
    const letter = text[pos];
    if (!/[bBpPgG]/.test(letter ?? '')) {
        return null;
    }
    test += letter;
    pos += 1;
    while (pos < text.length && /\d/.test(text[pos])) {
        test += text[pos];
        pos += 1;
    }
    skipWs();

    // At least one quoted string is required.
    if (text[pos] !== '"') {
        return null;
    }
    const first = readQuotedString(text, pos);
    if (!first) {
        return null;
    }
    const strings = [first.value];
    pos = first.pos;
    skipWs();
    if (text[pos] === '"') {
        const second = readQuotedString(text, pos);
        if (!second) {
            return null;
        }
        strings.push(second.value);
        pos = second.pos;
        skipWs();
    }

    if (text[pos] !== '}') {
        return null; // trailing garbage — not a conditional
    }

    const parsed = parseDescConditionalTest(test);
    if (!parsed) {
        return null;
    }
    const matches = evaluateParsedNCBTest(parsed, ctx);
    const chosen = matches ? strings[0] : (strings[1] ?? '');
    return { result: chosen, end: pos + 1 };
}

/**
 * Replaces every Bible conditional block "{test "a" "b"}" in `text`
 * with the string selected by `ctx`. Blocks that aren't well-formed are
 * passed through literally (a malformed dësc degrades rather than throwing).
 */
export function resolveConditionalBlocks(text: string,
    ctx: NCBTestContext): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] === '{') {
            const block = tryParseConditional(text, i, ctx);
            if (block) {
                out += block.result;
                i = block.end;
                continue;
            }
        }
        out += text[i];
        i += 1;
    }
    return out;
}
