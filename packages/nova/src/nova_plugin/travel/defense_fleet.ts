import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { PlanetData } from 'novadatainterface/planet_data';
import { isPort } from '../core/index.js';
import { StellarDefenderComponent } from '../ship/index.js';

/**
 * ============================================================================
 * A stellar's defence fleet in THIS system visit (#353 section 1)
 * ============================================================================
 *
 * The SHARED world state of one stellar's defence fleet, on the stellar's
 * own entity (`planet <spöb id>`). Absent until somebody demands tribute
 * there; the rules that write it are encounters/tribute.ts's.
 *
 * Matthew's ruling on #353 (2026-10-03), which this follows where the
 * original (a single-player game) measured otherwise:
 *  - "Any number of players may demand tribute at the same time. This
 *    spawns only one defence fleet, and if it's defeated, all the players
 *    are considered to have dominated the planet." So ONE fleet per
 *    stellar, and `demanders` is everyone fighting it.
 *  - "The player must defeat all the defence fleet ships in one go.
 *    Jumping away stops the ships spawning and resets it." So `launched`
 *    lives only as long as somebody in `demanders` stays in the system:
 *    the original keeps the count of defence ships LEFT in the pilot file
 *    (reference "Tribute (R18), wave 39"), across visits; here it is
 *    neither per pilot nor kept.
 *  - the wave cap: 6 defenders up per demanding player, 18 at most
 *    ({@link defenseWaveCap}), "a new defender spawns once one dies".
 *
 * While a player is among the `demanders` the stellar is HOSTILE to him
 * (MEASURED, reference "Tribute (R18), wave 39": the fleet answer turns
 * the planet hostile, "Status: Hostile" in the hail, until it gives in):
 * the hail's identity block reads {@link stellarHostileTo}. A laughed-off
 * demand turns only that one channel hostile (the hail dialog's own
 * business: reference "Hail dialog keys (K5), wave 39", a fresh hail later
 * in the same visit had no status line). Planetary weapons (#353 section
 * 2) are not implemented, so nothing else reads it. A player who leaves
 * the system is dropped.
 *
 * Serializer- and delta-registered (encounters/tribute.ts's TributePlugin),
 * so the hail dialog and the IFF on every display read it. Every list is
 * kept SORTED, so two peers that applied the same records in the same
 * ticks hold the same bytes.
 */
export const DefenseFleetType = t.type({
    /** Player ships demanding tribute here whose fleet is still up. */
    demanders: t.array(t.string),
    /** Defence ships launched in the current attempt (dead or alive). */
    launched: t.number,
    /** Sim time (ms) before which no further defence ship launches. */
    nextLaunch: t.number,
});
export type DefenseFleet = t.TypeOf<typeof DefenseFleetType>;
export const DefenseFleetComponent =
    new Component<DefenseFleet>('DefenseFleet');

/** Defenders up per demanding player (Matthew's ruling on #353). */
export const DEFENSE_WAVE_CAP_PER_PLAYER = 6;
/** "The wave cap can not exceed 18." */
export const DEFENSE_WAVE_CAP_MAX = 18;

/**
 * How many defence ships may be up at once against `demanders` players:
 * 6 each, never more than 18. Bay fighters they launch do not count.
 */
export function defenseWaveCap(demanders: number): number {
    return Math.max(0, Math.min(DEFENSE_WAVE_CAP_MAX,
        DEFENSE_WAVE_CAP_PER_PLAYER * demanders));
}

/** A fresh fleet record: nobody demanding, nothing launched. */
export function emptyDefenseFleet(): DefenseFleet {
    return { demanders: [], launched: 0, nextLaunch: 0 };
}

/** `list` plus `uuid`, sorted; a new array. */
export function sortedWith(list: readonly string[], uuid: string): string[] {
    return list.includes(uuid) ? [...list] : [...list, uuid].sort();
}

/**
 * Whether the stellar entity `planet` is hostile to `playerUuid`: its
 * defence fleet is up against him (see the module comment).
 */
export function stellarHostileTo(planet: Entity | undefined,
    playerUuid: string): boolean {
    return planet?.components.get(DefenseFleetComponent)?.demanders
        .includes(playerUuid) === true;
}

/**
 * Whether the ship `defender` is a defence ship (ship/stellar_defender.ts)
 * of a fleet that `playerUuid` is fighting, i.e. one of its stellar's
 * current demanders. The whole fleet is the demanders' enemy, whichever
 * of them each ship is assigned to: the IFF tier that paints it red
 * (combat/hostility.ts) and the defenders' own brains read this.
 */
export function defendsAgainst(defender: Entity, playerUuid: string,
    getEntity: (uuid: string) => Entity | undefined): boolean {
    const marker = defender.components.get(StellarDefenderComponent);
    if (!marker) {
        return false;
    }
    return getEntity(marker.planet)?.components.get(DefenseFleetComponent)
        ?.demanders.includes(playerUuid) === true;
}

/**
 * Whether a stellar takes a demand for tribute at all: one the hail dialog
 * opens a channel to, a port that is not a gate (Matthew's ruling on
 * #353: "Any planet that can be hailed and responds to hails ... can be
 * dominated"; display/hail_dialog_plugin.ts's hailIsUnanswerable).
 */
export function stellarTakesDemands(planetData: Pick<PlanetData,
    'flags' | 'gate'>): boolean {
    return isPort(planetData.flags) && !planetData.gate;
}
