import { RankData } from 'novadatainterface/rank_data';

/**
 * ============================================================================
 * Ranks — activation, the deactivation cascades, and the privileges
 * ============================================================================
 *
 * A ränk is a "sense of belonging to a given government" that also carries
 * concrete privileges. EVN Bible (ränk section):
 *
 *   "When a rank is made active (which is accomplished through any suitable
 *    control bit set string) the player is given all the privileges of that
 *    rank, whatever they might be, and the name of that rank is displayed in
 *    the player-info dialog."
 *
 * "Any suitable control bit set string" is the `Kxxx` (activate) and `Lxxx`
 * (deactivate) operators of the set language — see ncb.ts, which already
 * parses them. That makes the ACTIVE RANK SET exactly the same kind of state
 * as the control bits themselves: PLAYER-LOCAL, mutated on a working copy by
 * mission accept/success/abort/fail, cron OnStart/OnEnd and outfit
 * OnPurchase/OnSell, committed onto the player entity, and mirrored to peers
 * only through that committed (synced) component. Nothing here reads a clock
 * or a random source, so every peer that replays the same set strings reaches
 * the same set.
 *
 * THE CASCADES, verbatim from the Bible's Flags table:
 *
 *   0x0001 "Deactivate all other active ranks affiliated with this same govt
 *           when this rank is activated (excludes permanent ranks)"
 *   0x0002 "... when this rank is deactivated (excludes permanent ranks)"
 *   0x0010 "Deactivate all other active and lower-weighted ranks affiliated
 *           with this same govt when this rank is activated (excludes
 *           permanent ranks)"
 *   0x0020 "... when this rank is deactivated (excludes permanent ranks)"
 *   0x0008 "Rank is permanent and cannot be deactivated except if explicitly
 *           done by a control bit eval string"
 *
 * Read together, 0x0008 does NOT make a rank undroppable: it exempts it from
 * the cascades ("excludes permanent ranks") while leaving an explicit `Lxxx`
 * able to drop it. `deactivateRank` therefore always removes its target, and
 * only the cascade helpers skip permanent ranks. Stock data leans on this:
 * nearly every stock rank is permanent (0x0008), including nova:147.
 *
 * A cascade does NOT re-trigger the cascades of the ranks it drops. The Bible
 * describes each flag as a direct effect of the rank being activated or
 * deactivated, and recursing would let two same-govt ranks with 0x0002 chain
 * arbitrarily far (and, with a cycle, forever).
 *
 * A rank with no affiliated government (AffilGovt -1: stock nova:151 "Cunjo
 * Hunter" and nova:152 "Sworn Enemy of the Wild Geese") has no "same govt" to
 * cascade over, and none of the govt-scoped privileges below apply to it. It
 * is a pure honour, which is precisely how the stock data uses it.
 */

/** The player's active ranks: global ränk ids (e.g. 'nova:147'). */
export type ActiveRanks = Set<string>;

/** Resolves a global ränk id to its data; undefined when unknown. */
export type RankLookup = (id: string) => RankData | undefined;

/**
 * Whether `candidate` is dropped by a cascade `source` triggers.
 * `lowerOnly` is the 0x0010/0x0020 variant ("and lower-weighted").
 */
function cascadeDrops(source: RankData, candidate: RankData,
    lowerOnly: boolean): boolean {
    if (candidate.id === source.id) {
        return false; // "all OTHER active ranks".
    }
    if (candidate.rankFlags.permanent) {
        return false; // "(excludes permanent ranks)".
    }
    if (source.affilGovt === null
        || candidate.affilGovt !== source.affilGovt) {
        return false; // "affiliated with this same govt".
    }
    return !lowerOnly || candidate.weight < source.weight;
}

function runCascade(active: ActiveRanks, source: RankData,
    getRank: RankLookup, all: boolean, lower: boolean): void {
    if (!all && !lower) {
        return;
    }
    for (const id of [...active]) {
        const candidate = getRank(id);
        if (!candidate) {
            continue;
        }
        if ((all && cascadeDrops(source, candidate, false))
            || (lower && cascadeDrops(source, candidate, true))) {
            active.delete(id);
        }
    }
}

/**
 * `Kxxx`: activates rank `id`, then runs its 0x0001 / 0x0010 activation
 * cascades. Unknown ranks are still recorded — a plug-in's rank may be
 * granted by a set string this build cannot resolve, and dropping it would
 * silently lose player state across a save.
 */
export function activateRank(active: ActiveRanks, id: string,
    getRank: RankLookup): void {
    active.add(id);
    const rank = getRank(id);
    if (!rank) {
        return;
    }
    runCascade(active, rank, getRank,
        rank.rankFlags.dropOtherRanksWhenActivated,
        rank.rankFlags.dropLowerRanksWhenActivated);
}

/**
 * `Lxxx`: deactivates rank `id` — including a permanent one, which is what
 * "cannot be deactivated except if explicitly done by a control bit eval
 * string" licenses — then runs its 0x0002 / 0x0020 cascades.
 */
export function deactivateRank(active: ActiveRanks, id: string,
    getRank: RankLookup): void {
    const wasActive = active.delete(id);
    const rank = getRank(id);
    if (!rank || !wasActive) {
        return;
    }
    runCascade(active, rank, getRank,
        rank.rankFlags.dropOtherRanksWhenDeactivated,
        rank.rankFlags.dropLowerRanksWhenDeactivated);
}

/**
 * The active ranks' data, highest weight first — the Bible's display and
 * <PRK> order: "Ranks with higher weight are displayed first in the
 * player-info dialog, and the active rank with the highest weight is
 * selected for the <PRK> and <PSR> mission briefing tags." Ties break on id
 * so the order is total (and identical on every peer). Ranks this build
 * cannot resolve are skipped.
 */
export function activeRankData(active: Iterable<string> | undefined,
    getRank: RankLookup): RankData[] {
    const ranks: RankData[] = [];
    for (const id of active ?? []) {
        const rank = getRank(id);
        if (rank) {
            ranks.push(rank);
        }
    }
    return ranks.sort((a, b) =>
        b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Every active rank affiliated with `govtId` (null govt matches nothing). */
export function ranksForGovt(active: Iterable<string> | undefined,
    getRank: RankLookup, govtId: string | null | undefined): RankData[] {
    if (!govtId) {
        return [];
    }
    return activeRankData(active, getRank)
        .filter(rank => rank.affilGovt === govtId);
}

/**
 * 0x0200: "All planets of the affiliated government will let the player land
 * when he has this rank, regardless of their MinStatus field."
 *
 * This is what unlocks the stock hypergate network. All 19 working gates are
 * spöb MinStatus 32767 ("Player can never land") and gövt nova:183
 * ("Hypergate"); ränk nova:147 "Have Access to Hypergate System" is affilGovt
 * nova:183 with flags 0x0208 (0x0200 | 0x0008 permanent), and is granted by
 * mïsn nova:898 "Deliver New Hypergate Code;Sigma4" (OnAccept `k147 S899
 * S900`) at the end of the Sigma Shipyards string — or by mïsn nova:608
 * "Steal Hypergate Codes;Rebel Sideline" (OnSuccess `b149 k147`). Before
 * either, every gate is shut, which is the intended game state.
 */
export function ranksAllowLanding(active: Iterable<string> | undefined,
    getRank: RankLookup, govtId: string | null | undefined): boolean {
    return ranksForGovt(active, getRank, govtId)
        .some(rank => rank.rankFlags.canAlwaysLandOnGovtStellars);
}

/**
 * 0x0100: "Ships of the affiliated government will not automatically attack
 * the player when he has this rank."
 */
export function ranksSuppressAggression(active: Iterable<string> | undefined,
    getRank: RankLookup, govtId: string | null | undefined): boolean {
    return ranksForGovt(active, getRank, govtId)
        .some(rank => rank.rankFlags.govtShipsWontAttack);
}

/**
 * 0x0400: "Player can always request battle assistance from ships of the
 * affiliated government, who will also call in reinforcements on the
 * player's behalf if they are available."
 */
export function ranksAllowAssistance(active: Iterable<string> | undefined,
    getRank: RankLookup, govtId: string | null | undefined): boolean {
    return ranksForGovt(active, getRank, govtId)
        .some(rank => rank.rankFlags.canRequestBattleAssistance);
}

/**
 * 0x0800: "Ships allied with the affiliated govt will always repair or refuel
 * the player for free."
 */
export function ranksGiveFreeRepair(active: Iterable<string> | undefined,
    getRank: RankLookup, govtId: string | null | undefined): boolean {
    return ranksForGovt(active, getRank, govtId)
        .some(rank => rank.rankFlags.freeRefuelAndRepair);
}

/**
 * The union of the active ranks' Contribute sets — "Another 64 bits of
 * Contribute values that kick in when the rank is active. These can be used
 * to prevent the player from buying certain items or doing certain missions
 * until achieving a certain rank." Decimal strings, per-plug-in namespaced by
 * novaparse (flag_namespace.ts), so this may exceed 64 bits.
 */
export function rankContribute(active: Iterable<string> | undefined,
    getRank: RankLookup): bigint {
    let contribute = 0n;
    for (const rank of activeRankData(active, getRank)) {
        try {
            contribute |= BigInt(rank.contribute);
        } catch {
            // Garbage in the data: contribute nothing rather than throw.
        }
    }
    return contribute;
}

/**
 * The PriceMod multiplier to apply at a stellar OWNED BY `govtId`, as a
 * percentage. "Used to modify the prices of items and ships at planets owned
 * by the affiliated government. A value of 100 equals 100% of original price
 * (i.e. prices are unchanged). Higher or lower values raise or lower the
 * prices correspondingly."
 *
 * "Owned by" is read as ownership only — a stellar whose gövt IS the rank's
 * AffilGovt. An ally's worlds are not the affiliated government's worlds, and
 * every other rank privilege that reaches beyond ownership says so in its own
 * words (0x0800 is explicitly "ships ALLIED with the affiliated govt", while
 * 0x0200 is "all planets OF the affiliated government").
 *
 * ZERO MEANS UNUSED, not free. Ten stock ranks (nova:145, 146, 147, and
 * 151-158) leave PriceMod at 0 while carrying real privileges; reading that
 * literally would hand the player every ship and outfit in Federation and
 * Hypergate space for nothing. Extra Outfits agrees: its ränk 162 "GRN Racing
 * License" and 177 "Have Access to Stargate System" are PriceMod 0 with an
 * AffilGovt, and neither is meant to be a shopping spree. The same "0 or -1
 * means unused" convention the Bible states outright for SalaryCap.
 *
 * SEVERAL AFFILIATED RANKS COMPOUND: each one's percentage is applied in
 * turn, so two 50% ranks give 25% and not 50%. This is the reading the
 * plug-in data forces, and the evidence is unusually sharp. Extra Outfits'
 * Spica Shipyard — the station the player pays 10,000,000 cr to build (oütf
 * extra-outfits:552 "Buy Station", OnPurchase `b20001 N800 K167 K168 K169
 * K170 K171`) — is spöb extra-outfits:802, gövt extra-outfits:302 "SSC"
 * (Spica Shipyard Corp.). Four of the five ranks that purchase grants,
 * extra-outfits:168-171, are otherwise EMPTY resources: no name, no ConvName,
 * no salary, no flags, weight 1 — nothing but AffilGovt extra-outfits:302 and
 * PriceMod 1. The author's intent is plainly "ships and outfits at my own
 * shipyard are free" (you already paid to construct them), and four identical
 * 1% ranks only reach free if they compound:
 *
 *   1 rank  -> 1%      of 12,000,000 (the Leviathan, the dearest hull there)
 *                      = 120,000 cr
 *   2 ranks -> 0.01%   =   1,200 cr
 *   3 ranks -> 0.0001% =      12 cr
 *   4 ranks -> 1e-6 %  =    0.12 cr -> 0 cr, and a 0 hire fee
 *
 * Four is exactly the smallest count that floors the most expensive ship in
 * the plug-in to zero — a coincidence far too tight to be one. Taking the
 * best (lowest) modifier instead would leave that hull at 120,000 cr and its
 * hire fee at 12,000 cr, which is not what the feature does.
 *
 * Compounding is also the only rule that behaves sanely as ranks accumulate:
 * stock nova:128 (85%) and nova:129 (60%) are both Federation and both
 * permanent, so a player who finishes the Fed string holds both, and "each
 * rank is a further discount" is what a promotion is supposed to feel like.
 *
 * The result is a percentage and may be fractional (1e-6 above). Only IEEE
 * multiply/divide are used, over `ranksForGovt`'s totally ordered list, so
 * every peer computes the identical double.
 */
export function rankPriceMod(active: Iterable<string> | undefined,
    getRank: RankLookup, govtId: string | null | undefined): number {
    let mod = 100;
    for (const rank of ranksForGovt(active, getRank, govtId)) {
        if (rank.priceMod > 0) {
            mod = mod * rank.priceMod / 100;
        }
    }
    return mod;
}

/**
 * The total salary the active ranks pay per day at a player cash of
 * `credits` — "The number of credits that the affiliated government will pay
 * the player, per day", capped by SalaryCap: "The maximum amount of money the
 * player can have before the affiliated government stops paying the salary.
 * Set to 0 or -1 if unused."
 *
 * The cap is tested against the cash the player had when the day began, so a
 * day's pay is all-or-nothing per rank and the order ranks are summed in
 * cannot change the total.
 */
export function rankSalaryPerDay(active: Iterable<string> | undefined,
    getRank: RankLookup, credits: number): number {
    let salary = 0;
    for (const rank of activeRankData(active, getRank)) {
        if (rank.salary === 0) {
            continue;
        }
        if (rank.salaryCap > 0 && credits >= rank.salaryCap) {
            continue;
        }
        salary += rank.salary;
    }
    return salary;
}

/**
 * The <PRK> / <PSR> expansions: "the active rank with the highest weight is
 * selected for the <PRK> and <PSR> mission briefing tags", skipping ranks
 * whose text field is empty ("If this is set to an empty string, the rank
 * will never be used in conversation"). Undefined when no active rank offers
 * one, which is the caller's cue to fall back to the Bible's "captain".
 */
export function rankConversationName(active: Iterable<string> | undefined,
    getRank: RankLookup, short: boolean): string | undefined {
    for (const rank of activeRankData(active, getRank)) {
        const name = short ? rank.shortName : rank.convName;
        if (name) {
            return name;
        }
    }
    return undefined;
}
