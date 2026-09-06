import { CronData } from 'novadatainterface/cron_data';
import { dateFromDayNumber } from '../player/index.js';
import {
    makeControlBitHooks, NCBParseError, RankHookOptions, runNCBSet,
    evaluateNCBTest,
} from '../ncb/index.js';
import { CronState, CronStates } from '../player/index.js';
import {
    ownsOutfit, resolveNumberedResource, setStringPrefix,
    systemDiscoveryOperators,
} from './mission_logic.js';
import { DiscoveryAccess, DiscoveryNCBOperators } from '../player/index.js';

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

/** An ordinal for a (month, day) pair, months normalised to 31 days. */
function monthDayValue(month: number, day: number): number {
    return (month - 1) * 31 + (day - 1);
}

/**
 * Whether `day` falls inside a crön's First / Last date window.
 *
 * THE BIBLE MAKES EVERY FIELD SEPARATELY IGNORABLE: FirstDay is "the first
 * day of the month (1-31) on which the cron event can be activated. If you
 * set this to 0 or -1, this field will be ignored and only FirstMonth and
 * FirstYear will be considered", and each of the other five says the same
 * of itself. So the window is a conjunction of independently-droppable
 * constraints, NOT one absolute instant with defaults filled in — and that
 * distinction is the whole bug this function used to have.
 *
 * The old code substituted ±Infinity for a wildcarded year into a single
 * scalar `((year * 12 + month) * 31 + day)` comparison. An infinite year
 * swamps the month and day terms outright, so ANY cron with a wildcarded
 * year was in range on every day of the game. Stock crön nova:156, the
 * "Auroran Drop Bear Mating Season" (First 1/9/-1, Last 30/12/-1), is
 * exactly that shape: a September-to-December season that fired — and set
 * its news bit b42 — in March.
 *
 * TWO REGIMES, told apart by whether the window names a YEAR at all:
 *
 *  - BOTH years wildcarded: a RECURRING SEASON. Only the (month, day) pair
 *    is compared, so the window comes round again every year. A window
 *    whose end falls before its start (First 15/11, Last 10/2) WRAPS
 *    through New Year rather than matching nothing, which is the only
 *    reading under which such a window means anything. Fully wildcarded
 *    degenerates to 1 January - 31 December, i.e. always: unchanged, and
 *    that is 122 of the 125 stock cröns.
 *  - EITHER year set: one ABSOLUTE span, compared as whole dates the way
 *    it always was, with a missing year left open-ended and a missing
 *    month/day filled in at its permissive extreme. Stock nova:128
 *    (1/1/1183 - 31/12/1200) and nova:129 (1/1/1178 - 1/1/1179) are this
 *    shape, and both keep their existing behaviour exactly.
 *
 * The mixed case — one year set beside a month/day season, which no stock
 * crön uses — reads as the absolute span, since a named year is the clearer
 * evidence that a specific instant was meant.
 */
function inDateRange(cron: CronData, day: number): boolean {
    const date = dateFromDayNumber(day);
    // 0/-1 fields are wildcards.
    const fromDay = cron.firstDay > 0 ? cron.firstDay : 1;
    const fromMonth = cron.firstMonth > 0 ? cron.firstMonth : 1;
    const toDay = cron.lastDay > 0 ? cron.lastDay : 31;
    const toMonth = cron.lastMonth > 0 ? cron.lastMonth : 12;

    if (cron.firstYear <= 0 && cron.lastYear <= 0) {
        const from = monthDayValue(fromMonth, fromDay);
        const to = monthDayValue(toMonth, toDay);
        const here = monthDayValue(date.month, date.day);
        return from <= to
            ? here >= from && here <= to
            // Wraps through New Year: inside means past the start OR
            // before the end.
            : here >= from || here <= to;
    }

    const value = (d: { day: number, month: number, year: number }) =>
        d.year * 12 * 31 + monthDayValue(d.month, d.day);
    const fromYear = cron.firstYear > 0 ? cron.firstYear : -Infinity;
    const toYear = cron.lastYear > 0 ? cron.lastYear : Infinity;
    return value(date) >= value(
        { day: fromDay, month: fromMonth, year: fromYear })
        && value(date) <= value(
            { day: toDay, month: toMonth, year: toYear });
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

/**
 * The namespace a bare resource number inside this crön's own scripting is
 * scoped to: the plug-in that WROTE it (mission_logic's setStringPrefix),
 * which is not its id's prefix when the crön overrides a stock one.
 */
function cronPrefix(cron: CronData): string {
    return setStringPrefix(cron);
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
                // Kxxx/Lxxx resolve stock-first like every sibling
                // operator (mission_logic's resolveNumberedResource,
                // through the rank data the hooks already carry): stock's
                // rank n when stock defines it, else this cron's own
                // plug-in's — which is also the id recorded when neither
                // defines n (rank_logic keeps unknown ids).
                ranks: ranks && {
                    ...ranks,
                    resolveId: id => resolveNumberedResource(id, prefix,
                        globalId => ranks.getRank(globalId) !== undefined),
                },
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
