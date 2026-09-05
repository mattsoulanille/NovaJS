/**
 * Nova control bits (NCBs). EV Nova exposes 10,000 boolean "control
 * bits" (b0 - b9999) that mission scripting reads and writes through
 * two little languages, both documented in the EVN Bible ("A quick
 * word about control bits and scripting in EV Nova"):
 *
 * - Test expressions are boolean expressions over the bits (plus a few
 *   special terms) used by availability fields, e.g. `b1 & (b2 | !b3)`,
 *   including the counted sets `( [b1 b2 b3] = 2 )`.
 * - Set expressions are lists of operations run when something happens
 *   (a mission completes, an outfit is bought, ...), e.g. `b1 !b2 ^b3
 *   G142 R(b4 !b5)`.
 *
 * This module is the pure parser/evaluator for both. It has no ECS
 * dependencies; storage of the bits themselves and the side-effecting
 * operators are supplied by the caller.
 */

import {
    FIRST_PRIVATE_PHYSICAL_CONTROL_BIT, isPhysicalControlBit, MAX_CONTROL_BIT,
} from 'novadatainterface/control_bit_namespaces';
import { RankData } from 'novadatainterface/rank_data';
import { activateRank, deactivateRank } from './rank_logic.js';

export class NCBParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCBParseError';
    }
}

/**
 * Bits are numbered b0 - b9999 in the data. The expressions this module
 * sees have already been namespaced per plug-in by NovaParse
 * (novaparse/src/ncb_namespace.ts): stock bits keep their numbers and
 * plug-in-private bits are renumbered to >= FIRST_PRIVATE_PHYSICAL_CONTROL_BIT,
 * so both ranges are accepted here; the gap between them never occurs in
 * well-formed data and is rejected exactly as an out-of-range raw bit
 * always was.
 */
export { MAX_CONTROL_BIT };

function parseBitNumber(digits: string, expression: string): number {
    const bit = parseInt(digits, 10);
    if (!isPhysicalControlBit(bit)) {
        throw new NCBParseError(
            `Control bit b${bit} out of range (b0 - b${MAX_CONTROL_BIT}, or a` +
            ` namespaced bit >= b${FIRST_PRIVATE_PHYSICAL_CONTROL_BIT})` +
            ` in ${JSON.stringify(expression)}`);
    }
    return bit;
}

// --- Test expressions ---

export type NCBTestExpression =
    /** Blank expressions evaluate to true. */
    | { type: 'true' }
    /** Bxxx: the value of control bit xxx. */
    | { type: 'bit', bit: number }
    /** Oxxx: the player owns at least one of outfit ID xxx. */
    | { type: 'outfit', id: number }
    /** Exxx: the player has explored system ID xxx. */
    | { type: 'explored', id: number }
    /** G: the player's gender (1 if male, 0 if female). */
    | { type: 'gender' }
    /** Pxxx: the game is registered ([P]aid for) or in its demo period. */
    | { type: 'registered', days: number }
    | { type: 'not', operand: NCBTestExpression }
    | { type: 'and', operands: NCBTestExpression[] }
    | { type: 'or', operands: NCBTestExpression[] }
    /**
     * `[ ]`: a counted set — "returns the number of 1s in the set" (EVN
     * Bible, test expressions). As a boolean it is nonzero, like every
     * other term ("evaluates to be true (nonzero)").
     */
    | { type: 'count', operands: NCBTestExpression[] }
    /**
     * `=`, `<`, `>`: "Comparison operators for counted sets. Returns 1 if
     * the set count is equal to, less than, or greater than the number on
     * the right." The Bible's example: `( [b1 b2 b3] = 2 )`.
     */
    | { type: 'compare', operator: '=' | '<' | '>', count: NCBTestExpression, value: number };

/**
 * Everything a test expression can ask about. `getBit` is the only
 * required part; the exotic terms default to sensible values for a
 * game that doesn't model them (no outfits, nothing explored, male,
 * registered).
 */
export interface NCBTestContext {
    /** Bxxx: the value of control bit xxx. */
    getBit(bit: number): boolean;
    /** Oxxx: whether the player owns at least one of outfit ID xxx. */
    hasOutfit?(id: number): boolean;
    /**
     * Exxx: whether the player has explored sÿst ID xxx — discovery level
     * >= 1 ("visited"), see discovery.ts's discoveryNCBOperators, which is
     * what callers build this from.
     *
     * ABSENT MEANS FALSE, and that is the right answer for the one family
     * of evaluations that has no player to ask: the shared NPC spawn tables
     * (npc_spawn_plugin's flët AppearOn / përs ActiveOn) are genesis state
     * computed identically on every peer, so they evaluate under a context
     * whose bits are all clear too. One player's private map knowledge must
     * not decide what spawns for everybody, exactly as their control bits
     * do not.
     *
     * SUPPLIED at the player-local test sites the scenario data drives:
     * a mïsn's AvailBits (mission_logic's testBits), a crön's EnableOn
     * (cron_logic's enableOnPasses) and an oütf's Availability
     * (outfitter_rules' availabilityTest). The other player-local tests —
     * shïp Availability (shipyard_stock_rules), sÿst Visibility
     * (mission_universe / starmap / mission_logic's stellarVisible), jünk
     * BuyOn/SellOn (trade_logic) and öops ActivateOn (price_events) — leave
     * it at its default. Wire them the same way (a DiscoveryAccess plus a
     * systemExists lookup, through mission_logic's
     * systemDiscoveryOperators) if that ever becomes worth doing.
     *
     * WHAT THE DATA ACTUALLY CONTAINS: nothing. A sweep of every NCB test
     * field of every resource in stock "Nova Files" plus all 26 installed
     * plug-ins (9,979 non-empty expressions; the operator census by letter
     * is b 4152, p 320, o 286, bare-number 4) finds ZERO `Exxx` terms —
     * not in AvailBits, not in Availability, not in any Visibility, not in
     * a dësc conditional (which cannot even spell one: desc_text's
     * tryParseConditional accepts only b/p/g). So the wired sites above
     * are wired on the Bible's word, and the unwired ones cost nothing.
     *
     * BEWARE `E` IN A SET STRING, which is a DIFFERENT operator: the
     * changeShip form (see parseNCBSet's 'e'). Arpia's oütf 511-516/518
     * OnPurchase strings carry `E455`-`E460`, which are shïp ids, and a
     * naive /[EX]\d+/ grep over NCB fields reports them as explored terms.
     */
    hasExplored?(id: number): boolean;
    /** G: the player's gender. True if male. */
    isMale?: boolean;
    /**
     * Pxxx: whether the game is registered ([P]aid for). Defaults to
     * true (NovaJS has no registration system); dësc rendering pins it to
     * {@link desc_text.IS_REGISTERED}.
     */
    isRegistered?: boolean;
}

type TestToken =
    | { kind: '(' | ')' | '!' | '&' | '|' | '[' | ']' | '=' | '<' | '>' }
    | { kind: 'term', term: NCBTestExpression }
    /**
     * A bare number: a control bit by the compatibility rule below, or
     * the constant on the right of a counted-set comparison. Which one is
     * the parser's call, so the digits are kept until then.
     */
    | { kind: 'number', digits: string };

function tokenizeTest(expression: string): TestToken[] {
    const tokens: TestToken[] = [];
    // Case doesn't matter, per the Bible.
    const lower = expression.toLowerCase();
    // The letter is OPTIONAL: see the bare-number compatibility rule in
    // parseNCBTest's docs. This pattern is MIRRORED by novaparse's
    // ncb_namespace.ts (TEST_TOKEN); keep the two in step.
    const pattern = /\s+|[()!&|\[\]=<>]|([bope]?)(\d+)|g/gy;
    let index = 0;
    while (index < lower.length) {
        pattern.lastIndex = index;
        const match = pattern.exec(lower);
        if (!match) {
            throw new NCBParseError(
                `Unexpected ${JSON.stringify(expression[index])} at index ` +
                `${index} in test expression ${JSON.stringify(expression)}`);
        }
        index = pattern.lastIndex;
        const [text, letter, digits] = match;
        if (/^\s+$/.test(text)) {
            continue;
        }
        if (digits !== undefined) {
            const value = parseInt(digits, 10);
            // A bare number is a control bit (compatibility rule).
            switch (letter || 'b') {
                case 'b':
                    if (letter === '') {
                        tokens.push({ kind: 'number', digits });
                        break;
                    }
                    tokens.push({
                        kind: 'term',
                        term: { type: 'bit', bit: parseBitNumber(digits, expression) },
                    });
                    break;
                case 'o':
                    tokens.push({ kind: 'term', term: { type: 'outfit', id: value } });
                    break;
                case 'e':
                    tokens.push({ kind: 'term', term: { type: 'explored', id: value } });
                    break;
                case 'p':
                    tokens.push({ kind: 'term', term: { type: 'registered', days: value } });
                    break;
            }
        } else if (text === 'g') {
            tokens.push({ kind: 'term', term: { type: 'gender' } });
        } else {
            tokens.push({ kind: text as '(' | ')' | '!' | '&' | '|' | '[' | ']' | '=' | '<' | '>' });
        }
    }
    return tokens;
}

/**
 * Parses a control bit test expression, e.g. `b13 & (b15 | !b72)`.
 * A blank expression parses to `{type: 'true'}`.
 *
 * Nova's own evaluator is "fairly primitive" and unpredictable about
 * mixed `&`/`|` without parentheses; this one gives `!` the highest
 * precedence, then `&`, then `|`, which agrees with Nova on all
 * properly-parenthesized expressions.
 *
 * COMPATIBILITY RULE (bare numbers). A term that is just a number, with
 * no `B`/`O`/`E`/`P` letter in front of it, is read as a CONTROL BIT --
 * as though the missing `b` were there. Real scenario data relies on
 * this, and it is not merely a plug-in author's slip:
 *
 *   - STOCK Nova mïsn 428 has AvailBits
 *     `!(b511 | b515) & !((b50 | 467) | b6666)`, and that same mission's
 *     OnFailure and OnAbort are both `b467 !b511`. The bare `467` is
 *     unmistakably bit 467, the mission's own "the player already blew
 *     this one" flag; on any other reading the mission re-offers after
 *     it has been failed, which it demonstrably does not.
 *   - oütf 471 of the Extra Outfits plug-in ("Empty Weapon Hull") has
 *     Availability `b9002 & b9003 & b9004 & !9001` — the same slip,
 *     gating the crafting step that builds the Self-Made Energon Cannon.
 *   - oütf 536 of the More Blasters CHEAT plug-in has Availability
 *     `0525` (leading zero and all), i.e. bit 525.
 *
 * The Bible warns that "the Nova evaluator is fairly primitive", which
 * is exactly the shape of a term reader that consumes an optional
 * leading letter and defaults to a bit lookup when there isn't one.
 * Rejecting these outright is worse than tolerating them: an
 * unparseable Availability falls OPEN (see outfitter_rules'
 * availabilityTest), so a strict reading does not fail safe, it silently
 * un-gates the very thing the expression exists to gate.
 */
export function parseNCBTest(expression: string): NCBTestExpression {
    const tokens = tokenizeTest(expression);
    if (tokens.length === 0) {
        return { type: 'true' };
    }
    let position = 0;

    function fail(message: string): never {
        throw new NCBParseError(
            `${message} in test expression ${JSON.stringify(expression)}`);
    }

    function parseOr(): NCBTestExpression {
        const operands = [parseAnd()];
        while (tokens[position]?.kind === '|') {
            position++;
            operands.push(parseAnd());
        }
        return operands.length === 1 ? operands[0] : { type: 'or', operands };
    }

    function parseAnd(): NCBTestExpression {
        const operands = [parseUnary()];
        while (tokens[position]?.kind === '&') {
            position++;
            operands.push(parseUnary());
        }
        return operands.length === 1 ? operands[0] : { type: 'and', operands };
    }

    function parseUnary(): NCBTestExpression {
        const token = tokens[position];
        if (!token) {
            fail('Unexpected end');
        }
        switch (token.kind) {
            case '!':
                position++;
                return { type: 'not', operand: parseUnary() };
            case '(': {
                position++;
                const inner = parseOr();
                if (tokens[position]?.kind !== ')') {
                    fail('Expected ")"');
                }
                position++;
                return inner;
            }
            case '[':
                return parseCountedSet();
            case 'term':
                position++;
                return token.term;
            case 'number':
                // A bare number in term position is a control bit
                // (compatibility rule); range-checked here rather than in
                // the tokenizer because after `=`/`<`/`>` it is a count.
                position++;
                return { type: 'bit', bit: parseBitNumber(token.digits, expression) };
            default:
                fail(`Unexpected "${token.kind}"`);
        }
    }

    /**
     * `[ e1 e2 ... ]`, optionally followed by `= n`, `< n` or `> n`.
     * Elements are whitespace-separated unary expressions (a term, `!term`
     * or a parenthesised expression); the Bible's examples use bare bits.
     * The constant on the right must be a bare number: a `b`-prefixed one
     * is a bit, not a count.
     */
    function parseCountedSet(): NCBTestExpression {
        position++; // '['
        const operands: NCBTestExpression[] = [];
        while (tokens[position]?.kind !== ']') {
            if (!tokens[position]) {
                fail('Expected "]"');
            }
            operands.push(parseUnary());
        }
        position++; // ']'
        const count: NCBTestExpression = { type: 'count', operands };
        const next = tokens[position];
        if (next?.kind !== '=' && next?.kind !== '<' && next?.kind !== '>') {
            return count;
        }
        position++;
        const value = tokens[position];
        if (value?.kind !== 'number') {
            fail(`Expected a number after "${next.kind}"`);
        }
        position++;
        return {
            type: 'compare', operator: next.kind, count,
            value: parseInt(value.digits, 10),
        };
    }

    const parsed = parseOr();
    if (position !== tokens.length) {
        fail('Trailing tokens');
    }
    return parsed;
}

export function evaluateParsedNCBTest(expression: NCBTestExpression,
    context: NCBTestContext): boolean {
    switch (expression.type) {
        case 'true':
            return true;
        case 'bit':
            return context.getBit(expression.bit);
        case 'outfit':
            return context.hasOutfit?.(expression.id) ?? false;
        case 'explored':
            return context.hasExplored?.(expression.id) ?? false;
        case 'gender':
            return context.isMale ?? true;
        case 'registered':
            // NovaJS is always "registered" unless the context overrides it.
            return context.isRegistered ?? true;
        case 'not':
            return !evaluateParsedNCBTest(expression.operand, context);
        case 'and':
            return expression.operands.every(
                operand => evaluateParsedNCBTest(operand, context));
        case 'or':
            return expression.operands.some(
                operand => evaluateParsedNCBTest(operand, context));
        case 'count':
            // "true (nonzero)": a set with at least one 1 in it.
            return countNCBTest(expression, context) > 0;
        case 'compare': {
            const count = countNCBTest(expression.count, context);
            switch (expression.operator) {
                case '=':
                    return count === expression.value;
                case '<':
                    return count < expression.value;
                case '>':
                    return count > expression.value;
            }
        }
    }
}

/**
 * The numeric value of a test expression: for a counted set, "the number
 * of 1s in the set"; for anything else, 1 or 0 — the Bible's evaluator is
 * numeric throughout ("evaluates to be true (nonzero)").
 */
function countNCBTest(expression: NCBTestExpression,
    context: NCBTestContext): number {
    if (expression.type === 'count') {
        let count = 0;
        for (const operand of expression.operands) {
            if (evaluateParsedNCBTest(operand, context)) {
                count++;
            }
        }
        return count;
    }
    return evaluateParsedNCBTest(expression, context) ? 1 : 0;
}

/**
 * Evaluates a control bit test expression. A blank expression is true.
 * Throws `NCBParseError` on malformed expressions.
 */
export function evaluateNCBTest(expression: string,
    context: NCBTestContext): boolean {
    return evaluateParsedNCBTest(parseNCBTest(expression), context);
}

// --- Set expressions ---

export type NCBSetOperation =
    /** bxxx: set control bit xxx. */
    | { type: 'set', bit: number }
    /** !bxxx: clear control bit xxx. */
    | { type: 'clear', bit: number }
    /** ^bxxx: toggle control bit xxx. */
    | { type: 'toggle', bit: number }
    /** R(<op1> <op2>): run one of the two operations at random. */
    | { type: 'random', choices: [NCBSetOperation, NCBSetOperation] }
    /** Axxx: if mission ID xxx is currently active, abort it. */
    | { type: 'abortMission', id: number }
    /** Fxxx: if mission ID xxx is currently active, cause it to fail. */
    | { type: 'failMission', id: number }
    /** Sxxx: start mission ID xxx automatically. */
    | { type: 'startMission', id: number }
    /** Gxxx: grant one of outfit ID xxx to the player. */
    | { type: 'grantOutfit', id: number }
    /**
     * Dxxx: remove (delete) one of outfit ID xxx from the player.
     *
     * DELIBERATELY UNGUARDED against stranding bay fighters. The outfitter
     * and shipyard both refuse to part the player from a bay while its
     * fighters are deployed (outfitter_rules canSellOutfit, shipyard_rules
     * judgment call 8), but a Dxxx naming a bay outfit takes it anyway:
     * these operations are the scenario author's word, and Gxxx/Dxxx
     * already bypass every outfitter check by design (see
     * makeControlBitHooks below). A mission that confiscates a carrier's
     * bay is entitled to do so.
     *
     * The stranded fighters then take the graceful-loss path rather than
     * crashing: bay_plugin's ReturnAI only needs the carrier entity, which
     * still exists, and refundFighterToBay finds zero bays mounted, so the
     * magazine capacity is zero and each fighter is absorbed on docking
     * without being credited back.
     */
    | { type: 'removeOutfit', id: number }
    /**
     * Mxxx / Nxxx: move the player to system xxx. M puts the player on
     * top of the system's first stellar (or its centre); N keeps the
     * player's x/y coordinates relative to the system centre.
     */
    | { type: 'moveToSystem', id: number, keepCoordinates: boolean }
    /**
     * Cxxx / Exxx / Hxxx: change the player's ship to ship type xxx.
     * C keeps the player's outfits and grants none of the new ship's
     * defaults; E keeps the player's outfits and also grants the
     * defaults; H drops nonpersistent outfits and grants the defaults.
     */
    | {
        type: 'changeShip', id: number,
        outfits: 'keep' | 'keepAndGrantDefaults' | 'dropAndGrantDefaults',
    }
    /** Kxxx: activate rank ID xxx. */
    | { type: 'activateRank', id: number }
    /** Lxxx: deactivate rank ID xxx. */
    | { type: 'deactivateRank', id: number }
    /** Pxxx: play sound ID xxx. */
    | { type: 'playSound', id: number }
    /** Yxxx: destroy stellar ID xxx. */
    | { type: 'destroyStellar', id: number }
    /** Uxxx: regenerate (un-destroy) stellar ID xxx. */
    | { type: 'regenerateStellar', id: number }
    /**
     * Qxxx: make the player immediately leave (absquatulate) whatever
     * stellar he's landed on, showing a message from STR# ID xxx.
     */
    | { type: 'leaveStellar', stringId: number }
    /**
     * Txxx: change the name (title) of the player's ship to a string
     * randomly selected from STR# resource ID xxx.
     */
    | { type: 'renameShip', stringId: number }
    /** Xxxx: make system ID xxx be explored. */
    | { type: 'exploreSystem', id: number };

/**
 * The side effects a set expression can request. Bit mutation is
 * required; every other operator is optional and ignored (with a
 * console warning) when its hook is absent, so callers only implement
 * what their part of the game supports.
 *
 * Note that `grantOutfit` (Gxxx) bypasses all purchase requirements:
 * free mass, hardpoints, the outfit's Max count, availability, and
 * Require bits.
 */
export interface NCBSetHooks {
    setBit(bit: number): void;
    clearBit(bit: number): void;
    toggleBit(bit: number): void;
    /** Gxxx. Must ignore purchase limits. */
    grantOutfit?(id: number): void;
    /** Dxxx */
    removeOutfit?(id: number): void;
    /** Axxx */
    abortMission?(id: number): void;
    /** Fxxx */
    failMission?(id: number): void;
    /** Sxxx */
    startMission?(id: number): void;
    /** Mxxx / Nxxx */
    moveToSystem?(id: number, keepCoordinates: boolean): void;
    /** Cxxx / Exxx / Hxxx */
    changeShip?(id: number,
        outfits: 'keep' | 'keepAndGrantDefaults' | 'dropAndGrantDefaults'): void;
    /** Kxxx */
    activateRank?(id: number): void;
    /** Lxxx */
    deactivateRank?(id: number): void;
    /** Pxxx */
    playSound?(id: number): void;
    /** Yxxx */
    destroyStellar?(id: number): void;
    /** Uxxx */
    regenerateStellar?(id: number): void;
    /** Qxxx */
    leaveStellar?(stringId: number): void;
    /** Txxx */
    renameShip?(stringId: number): void;
    /** Xxxx */
    exploreSystem?(id: number): void;
}

/**
 * Parses a control bit set expression, e.g. `b1 !b2 ^b3 G142 R(b4 !b5)`.
 * A blank expression parses to no operations.
 *
 * COMPATIBILITY RULE (stray `&` / `|`). Set expressions are a LIST of
 * operations — the Bible: "These are simpler than the test
 * expressions... basically all you are doing here is listing what bits
 * you want to be modified", with no operators of their own beyond
 * `R(...)` ("No parentheses are supported for set expressions"). Yet
 * plug-in authors routinely carry the test language's `&` over into
 * them, writing `D613 & G615 & b9027` where they meant
 * `D613 G615 b9027`. Those characters are treated as whitespace here:
 * separators that separate nothing.
 *
 * The citing example is oütf 471 of the Extra Outfits plug-in ("Empty
 * Weapon Hull"), whose OnPurchase is
 * `!b9002 & !b9003 & !b9004 & b9001 G472 D468 D469 D470 D471 `. Because
 * parsing happens up front, rejecting the `&` threw away the WHOLE
 * string — so the Self-Made Energon Cannon (G472) was never granted
 * and the consumed parts (D468-D471) were never removed, which is
 * precisely the "I bought the hull and got no cannon" symptom. It is
 * not one plug-in's habit either: the same slip appears in the arpia
 * and HypergatePass plug-ins, in oütf, mïsn and crön set strings alike,
 * so the original engine plainly tolerated it.
 *
 * Note the trailing space in that same string: harmless already, but a
 * reminder that this data is hand-written and needs a forgiving reader.
 */
export function parseNCBSet(expression: string): NCBSetOperation[] {
    // Case doesn't matter, per the Bible.
    const lower = expression.toLowerCase();
    // The trailing [&|] alternative is the stray-separator rule above.
    const pattern = /\s+|([!^]?)b(\d+)|([afsgdmncehklpyuqtx])(\d+)|r\(|\)|[&|]/gy;
    let index = 0;

    function fail(message: string): never {
        throw new NCBParseError(
            `${message} in set expression ${JSON.stringify(expression)}`);
    }

    // Stack of R( groups under construction; the bottom entry collects
    // the top-level operations.
    const stack: NCBSetOperation[][] = [[]];
    while (index < lower.length) {
        pattern.lastIndex = index;
        const match = pattern.exec(lower);
        if (!match) {
            fail(`Unexpected ${JSON.stringify(expression[index])} at ` +
                `index ${index}`);
        }
        index = pattern.lastIndex;
        const [text, bitPrefix, bitDigits, opLetter, opDigits] = match;
        if (/^\s+$/.test(text) || text === '&' || text === '|') {
            // Whitespace, or a stray test-language separator (see above).
            continue;
        }
        const operations = stack[stack.length - 1];
        if (bitDigits !== undefined) {
            const bit = parseBitNumber(bitDigits, expression);
            operations.push(
                bitPrefix === '!' ? { type: 'clear', bit } :
                    bitPrefix === '^' ? { type: 'toggle', bit } :
                        { type: 'set', bit });
        } else if (opLetter !== undefined) {
            const id = parseInt(opDigits, 10);
            switch (opLetter) {
                case 'a': operations.push({ type: 'abortMission', id }); break;
                case 'f': operations.push({ type: 'failMission', id }); break;
                case 's': operations.push({ type: 'startMission', id }); break;
                case 'g': operations.push({ type: 'grantOutfit', id }); break;
                case 'd': operations.push({ type: 'removeOutfit', id }); break;
                case 'm': operations.push(
                    { type: 'moveToSystem', id, keepCoordinates: false });
                    break;
                case 'n': operations.push(
                    { type: 'moveToSystem', id, keepCoordinates: true });
                    break;
                case 'c': operations.push(
                    { type: 'changeShip', id, outfits: 'keep' });
                    break;
                case 'e': operations.push({
                    type: 'changeShip', id,
                    outfits: 'keepAndGrantDefaults',
                });
                    break;
                case 'h': operations.push({
                    type: 'changeShip', id,
                    outfits: 'dropAndGrantDefaults',
                });
                    break;
                case 'k': operations.push({ type: 'activateRank', id }); break;
                case 'l': operations.push({ type: 'deactivateRank', id }); break;
                case 'p': operations.push({ type: 'playSound', id }); break;
                case 'y': operations.push({ type: 'destroyStellar', id }); break;
                case 'u': operations.push({ type: 'regenerateStellar', id }); break;
                case 'q': operations.push({ type: 'leaveStellar', stringId: id }); break;
                case 't': operations.push({ type: 'renameShip', stringId: id }); break;
                case 'x': operations.push({ type: 'exploreSystem', id }); break;
            }
        } else if (text === 'r(') {
            stack.push([]);
        } else if (text === ')') {
            if (stack.length < 2) {
                fail(`Unmatched ")" at index ${index - 1}`);
            }
            const choices = stack.pop()!;
            if (choices.length !== 2) {
                fail(`R(...) takes exactly two operations, got ${choices.length}`);
            }
            stack[stack.length - 1].push({
                type: 'random',
                choices: [choices[0], choices[1]],
            });
        }
    }
    if (stack.length !== 1) {
        fail('Unclosed "R("');
    }
    return stack[0];
}

const warnedMissingHooks = new Set<string>();
function missingHook(name: string) {
    // TODO: Implement the remaining hooks (missions, ranks, stellar
    // destruction, ...) as their game features land.
    if (!warnedMissingHooks.has(name)) {
        warnedMissingHooks.add(name);
        console.warn(`NCB set operation ${name} is not implemented here; ignoring.`);
    }
}

function runParsedNCBSetOperation(operation: NCBSetOperation,
    hooks: NCBSetHooks, random: () => number): void {
    switch (operation.type) {
        case 'set':
            hooks.setBit(operation.bit);
            break;
        case 'clear':
            hooks.clearBit(operation.bit);
            break;
        case 'toggle':
            hooks.toggleBit(operation.bit);
            break;
        case 'random':
            runParsedNCBSetOperation(
                operation.choices[random() < 0.5 ? 0 : 1], hooks, random);
            break;
        case 'grantOutfit':
            hooks.grantOutfit
                ? hooks.grantOutfit(operation.id)
                : missingHook('Gxxx (grant outfit)');
            break;
        case 'removeOutfit':
            hooks.removeOutfit
                ? hooks.removeOutfit(operation.id)
                : missingHook('Dxxx (remove outfit)');
            break;
        case 'abortMission':
            hooks.abortMission
                ? hooks.abortMission(operation.id)
                : missingHook('Axxx (abort mission)');
            break;
        case 'failMission':
            hooks.failMission
                ? hooks.failMission(operation.id)
                : missingHook('Fxxx (fail mission)');
            break;
        case 'startMission':
            hooks.startMission
                ? hooks.startMission(operation.id)
                : missingHook('Sxxx (start mission)');
            break;
        case 'moveToSystem':
            hooks.moveToSystem
                ? hooks.moveToSystem(operation.id, operation.keepCoordinates)
                : missingHook('Mxxx/Nxxx (move to system)');
            break;
        case 'changeShip':
            hooks.changeShip
                ? hooks.changeShip(operation.id, operation.outfits)
                : missingHook('Cxxx/Exxx/Hxxx (change ship)');
            break;
        case 'activateRank':
            hooks.activateRank
                ? hooks.activateRank(operation.id)
                : missingHook('Kxxx (activate rank)');
            break;
        case 'deactivateRank':
            hooks.deactivateRank
                ? hooks.deactivateRank(operation.id)
                : missingHook('Lxxx (deactivate rank)');
            break;
        case 'playSound':
            hooks.playSound
                ? hooks.playSound(operation.id)
                : missingHook('Pxxx (play sound)');
            break;
        case 'destroyStellar':
            hooks.destroyStellar
                ? hooks.destroyStellar(operation.id)
                : missingHook('Yxxx (destroy stellar)');
            break;
        case 'regenerateStellar':
            hooks.regenerateStellar
                ? hooks.regenerateStellar(operation.id)
                : missingHook('Uxxx (regenerate stellar)');
            break;
        case 'leaveStellar':
            hooks.leaveStellar
                ? hooks.leaveStellar(operation.stringId)
                : missingHook('Qxxx (leave stellar)');
            break;
        case 'renameShip':
            hooks.renameShip
                ? hooks.renameShip(operation.stringId)
                : missingHook('Txxx (rename ship)');
            break;
        case 'exploreSystem':
            hooks.exploreSystem
                ? hooks.exploreSystem(operation.id)
                : missingHook('Xxxx (explore system)');
            break;
    }
}

export function runParsedNCBSet(operations: NCBSetOperation[],
    hooks: NCBSetHooks, random: () => number): void {
    for (const operation of operations) {
        runParsedNCBSetOperation(operation, hooks, random);
    }
}

/**
 * Runs a control bit set expression against the given hooks. `random`
 * decides R(a b) choices; pass a deterministic source (e.g. the ECS
 * Random resource's `next`) when running inside the simulation.
 */
export function runNCBSet(expression: string, hooks: NCBSetHooks,
    random: () => number): void {
    runParsedNCBSet(parseNCBSet(expression), hooks, random);
}

/**
 * The active-ränk half of `makeControlBitHooks`: the working set of
 * active rank ids to mutate, plus the lookups needed to run the
 * Bible's deactivation cascades (see rank_logic.ts). Supplying this
 * wires `Kxxx` / `Lxxx` at every set-string site that has the player's
 * rank state to hand.
 */
export interface RankHookOptions {
    /** The working copy of the player's active ränk ids. */
    active: Set<string>;
    /** Maps a resource id like 147 to a global id like "nova:147". */
    resolveId(id: number): string;
    /** Resolves a global ränk id to its data, for the cascades. */
    getRank(id: string): RankData | undefined;
}

/**
 * The `Xxxx` half of `makeControlBitHooks`: the already-resolved
 * "make system xxx be explored" operation, built by the caller from the
 * player's discovery record and the running resource's plug-in prefix (see
 * discovery.ts's discoveryNCBOperators). Supplying it wires `Xxxx` at every
 * set-string site that can reach the owner's discovery store.
 *
 * NEVER SUPPLIED FROM INSIDE THE SIMULATION, and there is nowhere it could
 * be: no ECS system runs an NCB set string. Every set-string site is
 * player-local, and all four are wired — the mission machinery
 * (mission_logic's makeMissionSetHooks), the crons at a date advance
 * (cron_logic), the outfitter's OnPurchase/OnSell fallback path, and the
 * chär OnStart of a new pilot (browser.ts). That is exactly what a
 * per-client, per-pilot record like discovery requires.
 *
 * EVERY REAL USE IN THE DATA IS A MISSION ONACCEPT. The same sweep that
 * found no `Exxx` at all found exactly SIX `Xxxx`, all in stock, all in
 * mïsn OnAccept, all in the tutorial chain, and each naming the system
 * that holds that mission's own return stellar — the tutorial drawing the
 * next leg on your map before sending you there:
 *
 *     mïsn nova:251 "Head to Sol;Tutorial 001"          "b8339 X130"
 *     mïsn nova:630 "Trade between Earth and Port Kane" "X128"
 *     mïsn nova:631 "...Port Kane and New England"      "X162"
 *     mïsn nova:633 "Head to Rauther;Tutorial 005"      "X166"
 *     mïsn nova:757 "Ferry Barry to <RST>"              "X187"
 *     mïsn nova:758 "Take Barry to <RST>"               "X187"
 *
 * (Tutorial 004, mïsn 632, sends you back to Earth and has an EMPTY
 * OnAccept — Sol was already revealed by Tutorial 001. The pattern is
 * deliberate.) No plug-in uses `Xxxx` at all, and no plug-in defines a
 * sÿst at any of local ids 128/130/162/166/187, so stock-first resolution
 * lands on the intended system whoever runs the string.
 */
export interface DiscoverySetHookOptions {
    /** Xxxx: make the sÿst with this resource id be explored. */
    exploreSystem(id: number): void;
}

/**
 * Hooks that mutate a `Set<number>` of control bits and optionally
 * grant/remove outfits in an `id -> count` map, activate/deactivate
 * ränks in a set of global rank ids, and mark systems explored. This is
 * what outfit OnPurchase/OnSell strings use; the outfit-count and rank maps
 * are keyed by global ids, so numeric resource ids pass through
 * `resolveId`.
 */
export function makeControlBitHooks(bits: Set<number>, outfitCounts?: {
    outfits: Map<string, number>,
    /** Maps a resource id like 142 to a global id like "nova:142". */
    resolveId(id: number): string,
}, ranks?: RankHookOptions,
    discovery?: DiscoverySetHookOptions): NCBSetHooks {
    const hooks: NCBSetHooks = {
        setBit: bit => bits.add(bit),
        clearBit: bit => bits.delete(bit),
        toggleBit: bit => bits.has(bit) ? bits.delete(bit) : bits.add(bit),
    };
    if (discovery) {
        hooks.exploreSystem = id => discovery.exploreSystem(id);
    }
    if (ranks) {
        const { active, resolveId, getRank } = ranks;
        hooks.activateRank = id =>
            activateRank(active, resolveId(id), getRank);
        hooks.deactivateRank = id =>
            deactivateRank(active, resolveId(id), getRank);
    }
    if (outfitCounts) {
        const { outfits, resolveId } = outfitCounts;
        // Grants bypass all purchase limits by design.
        hooks.grantOutfit = id => {
            const globalId = resolveId(id);
            outfits.set(globalId, (outfits.get(globalId) ?? 0) + 1);
        };
        hooks.removeOutfit = id => {
            const globalId = resolveId(id);
            const count = outfits.get(globalId) ?? 0;
            if (count > 1) {
                outfits.set(globalId, count - 1);
            } else {
                outfits.delete(globalId);
            }
        };
    }
    return hooks;
}
