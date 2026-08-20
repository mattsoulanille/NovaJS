import { CronData } from 'novadatainterface/cron_data';
import { dateFromDayNumber } from './calendar.js';
import {
    makeControlBitHooks, NCBParseError, RankHookOptions, runNCBSet,
    evaluateNCBTest,
} from './ncb.js';
import { CronState, CronStates } from './player_state_plugin.js';
import {
    resolveNumberedResource, sameNumberedResource, systemDiscoveryOperators,
} from './mission_logic.js';
import { DiscoveryAccess, DiscoveryNCBOperators } from './discovery.js';

/**
 * Per-player crön evaluation, run for each day the player's calendar
 * advances (jumps and landings). Follows the crön lifecycle from the
 * EVN Bible: while idle and inside the date range with EnableOn
 * passing, the daily Random% roll activates the event; PreHoldoff
 * days later OnStart runs; Duration days after that OnEnd runs; then
 * PostHoldoff days must pass before it may activate again.
 *
 * The Contribute/Require flags and the loop-OnStart / loop-OnEnd flags
 * are modeled (see stepCron): a cron only activates when its Require
 * mask is covered by the player's combined Contribute mask (ship,
 * outfits, and every currently-active cron's own Contribute), and the
 * loop flags re-run OnStart / OnEnd each day while their conditions
 * still hold.
 *
 * EnableOn sees the player's outfits (`Oxxx`, resolved in the cron's own
 * plug-in namespace like every other numeric reference in it) when the
 * caller supplies them: Extra Outfits' crön 604 "Take Away Officers" is
 * `EnableOn !O533` / `OnStart !b9010`, and without the outfits `!O533`
 * read as always-true, so the cron fired every day and cleared the
 * Officer Quarters bit the moment the player left the planet.
 *
 * The set strings GRANT and REMOVE outfits too (`Gxxx` / `Dxxx`), against
 * that same map, so a cron sees on one day what an earlier day's cron did.
 * That is a whole game feature and not a detail: Extra Outfits' Weapon
 * Construction Bay is nothing but five crons that consume building
 * materials on OnStart and hand back missiles Duration days later on
 * OnEnd, and stock Nova's "knock-off" crons (nova:288-292) turn a bought
 * knock-off part into the real outfit the same way.
 *
 * The player's map knowledge is wired the same way: EnableOn's `Exxx`
 * ("has the player explored system xxx") reads the discovery record and the
 * set strings' `Xxxx` ("make system xxx be explored") writes it, both in the
 * cron's own plug-in namespace. That is what lets the Bible's intended
 * pattern work — a cron that waits until the pilot has been somewhere, or
 * one that hands them a piece of the map.
 *
 * Remaining simplifications (documented gaps): the news strings are not
 * shown, and the mission/ship/stellar operators (Sxxx, Cxxx, Yxxx, ...)
 * are still ignored with a console warning. The player's Contribute mask
 * is the caller's snapshot from the start of the run, so an outfit a cron
 * grants does not contribute to another cron's Require until the next
 * date advance.
 */

/** What the crons may consult (and change) besides the bits. */
export interface CronEvaluationOptions {
    /** Kxxx / Lxxx: the player's active ranks (see ncb.ts). */
    ranks?: RankHookOptions;
    /**
     * The player's owned outfits, global id -> count (the
     * OutfitsStateComponent, flattened). Absent means "owns nothing".
     *
     * Read by `Oxxx` in EnableOn and MUTATED IN PLACE by `Gxxx` / `Dxxx`
     * in the set strings, so the caller must pass a working copy and write
     * it back afterwards (see mission_session's advanceEntityDate).
     */
    ownedOutfits?: Map<string, number>;
    /**
     * Whether a global outfit id exists, for resolving the bare numbers in
     * `Gxxx` / `Dxxx` (see mission_logic's resolveNumberedResource).
     * Without it a cron's number always means its own plug-in's outfit,
     * which is wrong whenever stock defines that number.
     */
    outfitExists?(globalId: string): boolean;
    /**
     * The player's per-system discovery record (discovery.ts), read by
     * `Exxx` in EnableOn and written by `Xxxx` in the set strings — the
     * same read/write relationship the outfits map has with `Oxxx` and
     * `Gxxx`/`Dxxx`. Absent means "nothing explored" and an ignored `Xxxx`.
     */
    discovery?: DiscoveryAccess;
    /**
     * Whether a global sÿst id exists, so `Exxx` / `Xxxx` resolve their
     * bare numbers stock-first (see mission_logic's
     * resolveExistingNumberedResource) and ignore ids nothing defines.
     */
    systemExists?(globalId: string): boolean;
}

function inDateRange(cron: CronData, day: number): boolean {
    const date = dateFromDayNumber(day);
    const first = { day: cron.firstDay, month: cron.firstMonth, year: cron.firstYear };
    const last = { day: cron.lastDay, month: cron.lastMonth, year: cron.lastYear };
    // 0/-1 fields are wildcards. Compare as full dates with the
    // wildcarded components substituted from the current date.
    const fromParts = {
        day: first.day > 0 ? first.day : 1,
        month: first.month > 0 ? first.month : 1,
        year: first.year > 0 ? first.year : -Infinity,
    };
    const toParts = {
        day: last.day > 0 ? last.day : 31,
        month: last.month > 0 ? last.month : 12,
        year: last.year > 0 ? last.year : Infinity,
    };
    const value = (d: { day: number, month: number, year: number }) =>
        (d.year * 12 + (d.month - 1)) * 31 + (d.day - 1);
    return value(date) >= value(fromParts) && value(date) <= value(toParts);
}

/**
 * One cron's resolved hook wiring, rebuilt per cron because every numeric
 * id in a set string is scoped to the plug-in that wrote that cron.
 */
interface CronSetContext {
    ranks?: RankHookOptions;
    outfits?: { outfits: Map<string, number>, resolveId(id: number): string };
    /** Exxx (EnableOn) and Xxxx (the set strings) for THIS cron's plug-in. */
    discovery?: DiscoveryNCBOperators;
}

function runCronSetString(expression: string, bits: Set<number>,
    random: () => number, context: CronSetContext): void {
    if (!expression) {
        return;
    }
    try {
        runNCBSet(expression, makeControlBitHooks(
            bits, context.outfits, context.ranks, context.discovery), random);
    } catch (e) {
        if (e instanceof NCBParseError) {
            console.warn('Bad crön set string:', e.message);
            return;
        }
        throw e;
    }
}

function enableOnPasses(cron: CronData, bits: Set<number>,
    ownedOutfits?: ReadonlyMap<string, number>,
    discovery?: DiscoveryNCBOperators): boolean {
    try {
        return evaluateNCBTest(cron.enableOn, {
            getBit: bit => bits.has(bit),
            // A cron's Oxxx names the stock outfit xxx if there is one,
            // else the cron's own plug-in's; never a third plug-in's.
            hasOutfit: id => ownsOutfit(ownedOutfits, id, cronPrefix(cron)),
            // Exxx, scoped to this cron's plug-in the same way.
            ...(discovery ? { hasExplored: discovery.hasExplored } : {}),
        });
    } catch (e) {
        if (e instanceof NCBParseError) {
            console.warn('Bad crön EnableOn:', e.message);
            return false;
        }
        throw e;
    }
}

/** Parses a 64-bit Contribute/Require decimal string, 0n on garbage. */
function mask(decimal: string): bigint {
    try {
        return BigInt(decimal);
    } catch {
        return 0n;
    }
}

/**
 * Whether the player's combined Contribute mask covers the cron's
 * Require mask (each 1-bit in Require must be set in `contribute`). An
 * all-zero Require is always satisfied.
 */
function requireMet(cron: CronData, contribute: bigint): boolean {
    const require = mask(cron.require);
    return (require & contribute) === require;
}

function ownsOutfit(owned: ReadonlyMap<string, number> | undefined,
    id: number, prefix: string): boolean {
    if (!owned) {
        return false;
    }
    for (const [globalId, count] of owned) {
        if (count > 0 && sameNumberedResource(globalId, id, prefix)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether the cron may run / keep looping this day: EnableOn passes and
 * its Require mask is covered.
 */
function conditionsHold(cron: CronData, bits: Set<number>,
    contribute: bigint, ownedOutfits?: ReadonlyMap<string, number>,
    discovery?: DiscoveryNCBOperators): boolean {
    return enableOnPasses(cron, bits, ownedOutfits, discovery)
        && requireMet(cron, contribute);
}

/**
 * Steps one cron's state machine for day `day`, running its set
 * strings against `bits` as it starts/ends. `contribute` is the
 * player's combined Contribute mask (ship + outfits + active crons),
 * checked against the cron's Require mask.
 */
function stepCron(cron: CronData, state: CronState, day: number,
    bits: Set<number>, contribute: bigint, random: () => number,
    setContext: CronSetContext,
    ownedOutfits?: ReadonlyMap<string, number>): void {
    if (state.phase === 'idle') {
        // loopOnEnd: while inside the postHoldoff window after ending,
        // keep re-running OnEnd each day its conditions still hold.
        if (day < state.nextEligible) {
            if (cron.loopOnEnd && conditionsHold(cron, bits, contribute,
                ownedOutfits, setContext.discovery)) {
                runCronSetString(cron.onEnd, bits, random, setContext);
            }
            return;
        }
        if (!inDateRange(cron, day)) {
            return;
        }
        if (!conditionsHold(cron, bits, contribute, ownedOutfits,
            setContext.discovery)) {
            return;
        }
        const chance = cron.random >= 100 ? 100 : Math.max(0, cron.random);
        if (random() * 100 >= chance) {
            return;
        }
        state.phase = 'pre';
        state.phaseStart = day;
        // Fall through so preHoldoff 0 starts today.
    }
    if (state.phase === 'pre') {
        if (day < state.phaseStart + Math.max(0, cron.preHoldoff)) {
            return;
        }
        runCronSetString(cron.onStart, bits, random, setContext);
        state.phase = 'active';
        state.phaseStart = day;
        // Fall through so duration 0 ends today.
    } else if (state.phase === 'active' && cron.loopOnStart
        && day > state.phaseStart
        && conditionsHold(cron, bits, contribute, ownedOutfits,
            setContext.discovery)) {
        // loopOnStart: re-run OnStart each subsequent active day while
        // its conditions still hold (the entry day already ran it above).
        runCronSetString(cron.onStart, bits, random, setContext);
    }
    if (state.phase === 'active') {
        if (day < state.phaseStart + Math.max(0, cron.duration)) {
            return;
        }
        runCronSetString(cron.onEnd, bits, random, setContext);
        state.phase = 'idle';
        state.phaseStart = day;
        state.nextEligible = day + Math.max(0, cron.postHoldoff) + 1;
    }
}

/**
 * The player's combined Contribute mask for the crons currently in
 * their active phase, OR'd onto the base (ship + outfit) contribute.
 * Recomputed each day so a cron that activated today contributes to the
 * Require checks of others.
 */
function activeCronContribute(crons: CronData[], states: CronStates,
    base: bigint): bigint {
    let contribute = base;
    for (const cron of crons) {
        if (states.get(cron.id)?.phase === 'active') {
            contribute |= mask(cron.contribute);
        }
    }
    return contribute;
}

/** The plug-in prefix of a cron's global id ("nova:512" -> "nova"). */
function cronPrefix(cron: CronData): string {
    const colon = cron.id.lastIndexOf(':');
    return colon === -1 ? 'nova' : cron.id.slice(0, colon);
}

/**
 * Advances the cron state machines from `fromDay` (exclusive) to
 * `toDay` (inclusive), mutating `states`, `bits`, and — when the caller
 * supplies them in `options` — the active ranks and the owned outfits.
 * `baseContribute` is the player's ship + outfit Contribute mask (the
 * active crons' own Contribute is folded in per day); default 0n means no
 * contributions.
 */
export function runCronsForDays(crons: CronData[], states: CronStates,
    bits: Set<number>, fromDay: number, toDay: number,
    random: () => number = Math.random, baseContribute: bigint = 0n,
    options: CronEvaluationOptions | RankHookOptions = {}): void {
    // Older callers passed the rank hooks bare; tell the two apart by the
    // rank options' required `active` set.
    const {
        ranks, ownedOutfits, outfitExists, discovery, systemExists,
    }: CronEvaluationOptions =
        'active' in options ? { ranks: options } : options;
    // Every numeric id in a cron's set string is scoped to the plug-in that
    // wrote that cron, exactly as a mission's are, so the hook wiring is
    // per-cron. Built once each rather than once per day.
    const setContexts = new Map<CronData, CronSetContext>(
        crons.map(cron => {
            const prefix = cronPrefix(cron);
            return [cron, {
                ranks: ranks && { ...ranks, resolveId: id => `${prefix}:${id}` },
                // Gxxx/Dxxx are wired only when the caller handed over an
                // outfits map to mutate; without one they stay unimplemented
                // and ncb.ts warns, as every other missing hook does.
                outfits: ownedOutfits && {
                    outfits: ownedOutfits,
                    resolveId: id =>
                        resolveNumberedResource(id, prefix, outfitExists),
                },
                // Exxx / Xxxx, in this cron's own plug-in namespace.
                discovery: systemDiscoveryOperators(
                    discovery, prefix, systemExists),
            }];
        }));
    for (let day = fromDay + 1; day <= toDay; day++) {
        for (const cron of crons) {
            let state = states.get(cron.id);
            if (!state) {
                state = { phase: 'idle', phaseStart: 0, nextEligible: 0 };
                states.set(cron.id, state);
            }
            const contribute =
                activeCronContribute(crons, states, baseContribute);
            stepCron(cron, state, day, bits, contribute, random,
                setContexts.get(cron) ?? {}, ownedOutfits);
        }
    }
}
