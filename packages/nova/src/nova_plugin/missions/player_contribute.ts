import { CronData } from 'novadatainterface/cron_data';
import { RankLookup, rankContribute } from '../ncb/index.js';
import { CronStates } from '../player/index.js';

/**
 * THE PLAYER'S CONTRIBUTE SET, in one place. Every Require gate the player
 * faces — the outfitter's oütf Require, the shipyard's and the bar's shïp
 * Require, the mïsn Require of the mission computer and the bar, an escort
 * upgrade's hull — tests the same union (EVN Bible):
 *
 *  - the current hull's Contribute (shïp),
 *  - every owned outfit's (oütf),
 *  - every active rank's ("Another 64 bits of Contribute values that kick in
 *    when the rank is active"),
 *  - every ACTIVE crön's ("When the cron event is active, these two
 *    Contribute fields together form a 64-bit flag that is subsequently
 *    combined with the Contribute fields from the player's ship and the
 *    other outfit items in the player's possession, to be used with the
 *    Require fields in the outf and misn resources").
 *
 * Each venue used to OR its own subset, and none had the crons. The values
 * are namespaced per plug-in by novaparse (flag_namespace.ts), so the union
 * may be wider than 64 bits.
 */

/** A Contribute / Require field as stored — hex "0x..." (shïp, oütf) or
 * decimal (crön, ränk); garbage contributes nothing. */
export function contributeMask(value: string | undefined): bigint {
    try {
        return BigInt(value || '0');
    } catch {
        return 0n;
    }
}

/** Looks a crön up by global id. */
export type CronLookup = (id: string) => Pick<CronData, 'contribute'>
    | undefined;

/**
 * The union of the ACTIVE crons' Contribute: a crön counts from its OnStart
 * (phase 'active') until its OnEnd, not while it waits out its PreHoldoff
 * ('pre') — "when the cron event is active", which is also what
 * cron_logic's runCronsForDays folds in for the crons' own Require.
 */
export function activeCronContribute(states: CronStates | undefined,
    getCron: CronLookup): bigint {
    let contribute = 0n;
    for (const [id, state] of states ?? []) {
        if (state.phase === 'active') {
            contribute |= contributeMask(getCron(id)?.contribute);
        }
    }
    return contribute;
}

/** What {@link playerContribute} unions. Leave a source out and it
 * contributes nothing. */
export interface PlayerContributeSources {
    /** The current hull's Contribute. */
    ship?: string;
    /** The Contribute of each outfit the player owns (count above 0). */
    outfits?: Iterable<string | undefined>;
    /** The active ränks, and their lookup. */
    ranks?: Iterable<string>;
    getRank?: RankLookup;
    /** The crön states, and the crön lookup. */
    cronStates?: CronStates;
    getCron?: CronLookup;
}

/** The player's Contribute set: see the module comment. */
export function playerContribute(sources: PlayerContributeSources): bigint {
    let contribute = contributeMask(sources.ship);
    for (const outfit of sources.outfits ?? []) {
        contribute |= contributeMask(outfit);
    }
    if (sources.getRank) {
        contribute |= rankContribute(sources.ranks, sources.getRank);
    }
    if (sources.getCron) {
        contribute |=
            activeCronContribute(sources.cronStates, sources.getCron);
    }
    return contribute;
}
