/**
 * Conditional text in dësc resources, as the ORIGINAL expands it.
 *
 * The EVN Bible ("The dësc resource", ~:738) documents
 *
 *       {bXXX "string one" "string two"}
 *
 * with a leading "!" to negate, {G "male" "female"} and {P "paid"
 * "unpaid"}, "no testing of multiple bits at a time", and a missing second
 * string substituting nothing. What EV Nova 1.1.1 actually does was measured
 * on the reference Mac (docs/reference_experiments.md, "dësc test
 * operators, wave 54"), and it is a much more primitive scanner than the
 * Bible suggests. Per "{" in the text:
 *
 * 1. THE LETTER. It walks forward from the "{" one character at a time
 *    until it meets a b, g or p (either case). Everything else is skipped —
 *    spaces, other letters (o, e, x...), digits, parentheses, quotes, the
 *    block's own "}" and the text of later lines — so a block that does not
 *    start with b / g / p takes its test from the next b / g / p ANYWHERE
 *    after it ("{o609 ..." met the g of "get" in its own string), swallowing
 *    everything in between. If none is left in the text, the text ENDS at
 *    that "{": nothing after it is shown.
 * 2. "!" met on the way (before the letter or among the skipped
 *    characters) negates, and it is STICKY: every later block of the same
 *    text is negated too, a second "!" does not undo it. Each text starts
 *    un-negated.
 * 3. THE TERM is that one letter: b = control bit, the decimal digits right
 *    after it (none, or a space first, is bit 0; "b9351x" is bit 9351); g =
 *    male; p = registered (its digits read and ignored). Nothing after the
 *    term is part of the test: "b0 | o188", "b9351 & o188" and "(b1)" test
 *    the one bit. So there are no o / e / compound terms in a dësc.
 * 4. THE STRINGS. The first string starts at the first quote after the term
 *    and ends at the next unescaped one ("\" escapes the next character).
 *    TRUE: the first string, and the block ends at the first "}" after it
 *    (a second string, a third, or junk before the "}" is dropped). FALSE:
 *    from the end of the first string the scan goes to the next quote or
 *    "}" (junk between is skipped); "}" first means no second string
 *    (nothing is substituted), a quote starts the second string, and the
 *    block ends at the first "}" after that.
 * 5. Substituted text is not rescanned; the scan carries on after the "}".
 *
 * The malformed edges (no quote after the term, an unterminated string, no
 * "}" left) follow the same reference section; see {@link expandBlock}.
 *
 * Real data: stock "Nova Files" uses only {b/B...}, {G/g...} and {P...}
 * blocks; of the installed plug-ins only Extra Outfits' Inertial Damper
 * (dësc 3319, "{o609 ...}") starts a block with another letter, and the
 * original shows its text up to "License" plus one space (male pilots)
 * there, which this module now reproduces instead of printing the raw
 * block. No dësc anywhere uses "!".
 *
 * This module is display-side only: it reads control bits and pilot identity,
 * never mutates simulation state.
 */
import { loadPilotProfile } from '../../title/client_prefs.js';
import { NCBTestContext } from './ncb.js';

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
 * the ncb evaluator's male default). Only getBit / isMale / isRegistered are
 * ever read: a dësc block has no outfit or explored term.
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
 * The decimal digits starting exactly at `pos` (no leading space allowed:
 * the original read "{b 9351" as bit 0), and the index after them. No
 * digits is 0.
 */
function leadingNumber(text: string, pos: number): { value: number, end: number } {
    let end = pos;
    while (end < text.length && text[end] >= '0' && text[end] <= '9') {
        end += 1;
    }
    return { value: end > pos ? Number(text.slice(pos, end)) : 0, end };
}

/**
 * Reads a quoted string (with "\" escapes) starting at `text[pos]` (which
 * must be '"'), consuming the closing quote. An unterminated string runs to
 * the end of the text, as on the original ("E2[{b0 "Y" "N tail]" showed
 * "E2[N tail]").
 */
function readQuotedString(text: string, pos: number): { value: string, pos: number } {
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
    return { value, pos };
}

/** What one "{" turned into. */
type BlockResult =
    /** `text` replaces the block, and scanning resumes at `end`. */
    | { kind: 'substitute', text: string, end: number }
    /** The text ends here: nothing from the "{" on is shown. */
    | { kind: 'cut' };

/**
 * Expands the block whose "{" is at `open` (see the module comment for the
 * measured rules). `negate` is the text's sticky "!" state; the block may
 * set it, and the caller keeps it for the blocks after this one.
 *
 * The malformed edges, from the same reference runs (wave 54's `ops3`):
 * - no b / g / p after the "{", or no quote after the term: the text is
 *   cut at the "{" ("E4[{b0 noquote} tail]" showed "E4[");
 * - an unterminated string runs to the end of the text, and with no "}"
 *   after the chosen string the text ends with it (readQuotedString,
 *   substitute): the female Inertial Damper text ends "License}";
 * - false, with no second string and no "}" left: nothing more is shown.
 */
function expandBlock(text: string, open: number, ctx: NCBTestContext,
    state: { negate: boolean }): BlockResult {
    let pos = open + 1;
    let value: boolean | undefined;
    while (pos < text.length && value === undefined) {
        const c = text[pos];
        pos += 1;
        switch (c) {
            case '!':
                state.negate = true;
                break;
            case 'b':
            case 'B': {
                const bit = leadingNumber(text, pos);
                value = ctx.getBit(bit.value);
                pos = bit.end;
                break;
            }
            case 'g':
            case 'G':
                value = ctx.isMale ?? true;
                break;
            case 'p':
            case 'P':
                // Pxxx: "registered, or unregistered for under xxx days";
                // the days only matter to an unregistered copy.
                value = ctx.isRegistered ?? true;
                pos = leadingNumber(text, pos).end;
                break;
        }
    }
    if (value === undefined) {
        return { kind: 'cut' };
    }
    const result = state.negate ? !value : value;

    const quote = text.indexOf('"', pos);
    if (quote < 0) {
        return { kind: 'cut' };
    }
    const first = readQuotedString(text, quote);
    if (result) {
        return substitute(text, first.value, first.pos);
    }
    let scan = first.pos;
    while (scan < text.length && text[scan] !== '"' && text[scan] !== '}') {
        scan += 1;
    }
    if (scan >= text.length) {
        // Neither a second string nor a "}": nothing, and the text ends.
        return { kind: 'substitute', text: '', end: text.length };
    }
    if (text[scan] === '}') {
        return { kind: 'substitute', text: '', end: scan + 1 };
    }
    const second = readQuotedString(text, scan);
    return substitute(text, second.value, second.pos);
}

/**
 * The chosen string replaces the block through the first "}" after it;
 * with no "}" left, the string is the last thing shown ("E1[{b0 "Y" "N"
 * tail]" showed "E1[N").
 */
function substitute(text: string, chosen: string, from: number): BlockResult {
    const close = text.indexOf('}', from);
    return {
        kind: 'substitute', text: chosen,
        end: close < 0 ? text.length : close + 1,
    };
}

/**
 * Expands every "{...}" conditional block in `text` against `ctx`, the way
 * the original does (module comment). Text with no "{" comes back as is.
 */
export function resolveConditionalBlocks(text: string,
    ctx: NCBTestContext): string {
    let out = '';
    let i = 0;
    const state = { negate: false };
    while (i < text.length) {
        const open = text.indexOf('{', i);
        if (open < 0) {
            out += text.slice(i);
            break;
        }
        out += text.slice(i, open);
        const block = expandBlock(text, open, ctx, state);
        if (block.kind === 'cut') {
            break;
        }
        out += block.text;
        i = block.end;
    }
    return out;
}
