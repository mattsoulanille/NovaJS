import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';

/**
 * The stellars a pilot has DOMINATED (#353 section 3): spöb global ids,
 * sorted, no repeats.
 *
 * PER-PLAYER state (admin1's ruling on #306 and #353: "Domination is per
 * player"), like the original's pilot file, which keeps a `dominated` flag
 * per stellar. It lives on the player's ship, follows the pilot across
 * hull changes (missions/mission_ship_change.ts PLAYER_STATE_COMPONENTS)
 * and is saved with the pilot (pilot/save_game.ts `dominated`), so a
 * domination survives leaving the system, landings and days (MEASURED,
 * reference "Tribute (R18), wave 39", finding 6) until the pilot releases
 * the stellar over the hail channel.
 *
 * Written inside the simulation (encounters/tribute.ts: a demand the
 * stellar gives in to, the defeat of its defence fleet, a Release), always
 * as a NEW array — the value may be shared with a traded-in hull — and
 * delta-registered so the display (the hail dialog's Status line and
 * Release button, the player-info Income line) and an in-flight save read
 * it. Absent means none.
 */
export const DominatedType = t.array(t.string);
export type Dominated = t.TypeOf<typeof DominatedType>;
export const DominatedComponent = new Component<Dominated>('DominatedStellars');

/** Whether `entity`'s pilot has dominated the stellar `planetId`. */
export function hasDominated(entity: Entity | undefined,
    planetId: string): boolean {
    return entity?.components.get(DominatedComponent)?.includes(planetId)
        === true;
}

/** `list` with `planetId` added, sorted; a new array, never `list`. */
export function withDominated(list: readonly string[] | undefined,
    planetId: string): string[] {
    const next = new Set(list ?? []);
    next.add(planetId);
    return [...next].sort();
}

/** `list` without `planetId`; a new array, never `list`. */
export function withoutDominated(list: readonly string[] | undefined,
    planetId: string): string[] {
    return (list ?? []).filter(id => id !== planetId);
}

/**
 * Which of a stellar's set strings a domination change owes the pilot:
 * spöb OnDominate ("evaluated when the stellar is successfully dominated by
 * the player") or OnRelease ("... released from domination by the
 * player"), EVN Bible ~:2893-2898.
 */
export type StellarSetStringKind = 'dominate' | 'release';
export const StellarSetStringKindType: t.Type<StellarSetStringKind> =
    t.union([t.literal('dominate'), t.literal('release')]);

/**
 * One OnDominate / OnRelease the simulation has owed the pilot since the
 * tick the domination changed, until the owner's client pays it with a
 * `stellarSetString` record (encounters/tribute.ts applyStellarSetString).
 * `seq` is this pilot's running count, so the record names exactly one
 * entry: a duplicate, or a dominate / release / dominate of the same
 * stellar in quick succession, can never be paid twice or out of turn.
 */
export const PendingStellarSetStringType = t.type({
    seq: t.number,
    planetId: t.string,
    kind: StellarSetStringKindType,
});
export type PendingStellarSetString =
    t.TypeOf<typeof PendingStellarSetStringType>;

/**
 * The stellar set strings the simulation owes this pilot (see
 * PendingStellarSetStringType), oldest first, and the next `seq`.
 *
 * WHY A HAND-OFF. A set string is player-local machinery (ncb/ncb.ts: an
 * `Sxxx` needs mission data, a `Kxxx` ränk data, neither of which the
 * simulation reads), so the sim cannot run one. It marks the debt the tick
 * the domination changes — a demand the stellar gives in to, the defeat of
 * its defence fleet, a Release — and the owner's display
 * (display/stellar_set_string_plugin.ts) resolves the string against a
 * detached copy of the pilot, as an in-flight abort's OnAbort is
 * (spaceport/ship_mission_accept.ts buildStellarSetString), and sends the
 * deltas back. The deferred auto-abort's `autoAbortPending` is the same
 * shape. Only a stellar whose string is not blank is queued.
 *
 * Per-pilot like DominatedComponent: it follows the pilot across hull
 * changes (missions/mission_ship_change.ts PLAYER_STATE_COMPONENTS) and is
 * always written as a NEW value. Written into the pilot save while an
 * entry is owed (pilot/save_game.ts `stellarSetStrings`): the save keeps
 * the domination itself (`dominated`), so a save in the frames between the
 * domination and the record would otherwise keep the stellar dominated and
 * lose its string. The restored pilot's display pays it.
 */
export const PendingStellarSetStringsType = t.type({
    next: t.number,
    pending: t.array(PendingStellarSetStringType),
});
export type PendingStellarSetStrings =
    t.TypeOf<typeof PendingStellarSetStringsType>;
export const PendingStellarSetStringsComponent =
    new Component<PendingStellarSetStrings>('PendingStellarSetStrings');

/** The domination fields a pending string is queued from. */
export interface StellarSetStrings {
    onDominate: string;
    onRelease: string;
}

/**
 * Queues `kind` of `planetId` on `player` (a new value) when the string is
 * not blank. Returns whether anything was queued.
 */
export function queueStellarSetString(player: Entity, planetId: string,
    kind: StellarSetStringKind, strings: StellarSetStrings | undefined)
    : boolean {
    const expression = kind === 'dominate'
        ? strings?.onDominate : strings?.onRelease;
    if (!expression?.trim()) {
        return false;
    }
    const owed = player.components.get(PendingStellarSetStringsComponent);
    const seq = owed?.next ?? 0;
    player.components.set(PendingStellarSetStringsComponent, {
        next: seq + 1,
        pending: [...owed?.pending ?? [], { seq, planetId, kind }],
    });
    return true;
}

/**
 * Takes the entry `seq` for `planetId` off `player`'s pending list (a new
 * value) and returns it, or undefined when there is no such entry — a
 * duplicate, a replay or a record from a client that never owed it.
 */
export function takeStellarSetString(player: Entity, seq: number,
    planetId: string): PendingStellarSetString | undefined {
    const owed = player.components.get(PendingStellarSetStringsComponent);
    const entry = owed?.pending.find(e => e.seq === seq
        && e.planetId === planetId);
    if (!owed || !entry) {
        return undefined;
    }
    player.components.set(PendingStellarSetStringsComponent, {
        next: owed.next,
        pending: owed.pending.filter(e => e !== entry),
    });
    return entry;
}

/**
 * DOMINATES `planetId` for `player`: the stellar joins the pilot's
 * dominated list and its OnDominate is owed (queueStellarSetString). A
 * stellar the pilot already dominates changes nothing: its OnDominate ran
 * when it was dominated. Returns whether it is newly dominated.
 */
export function dominateStellar(player: Entity, planetId: string,
    strings: StellarSetStrings | undefined): boolean {
    if (hasDominated(player, planetId)) {
        return false;
    }
    player.components.set(DominatedComponent, withDominated(
        player.components.get(DominatedComponent), planetId));
    queueStellarSetString(player, planetId, 'dominate', strings);
    return true;
}

/**
 * RELEASES `planetId` from `player`'s domination, owing its OnRelease. A
 * stellar the pilot does not dominate changes nothing. Returns whether it
 * was released.
 */
export function releaseStellar(player: Entity, planetId: string,
    strings: StellarSetStrings | undefined): boolean {
    if (!hasDominated(player, planetId)) {
        return false;
    }
    player.components.set(DominatedComponent, withoutDominated(
        player.components.get(DominatedComponent), planetId));
    queueStellarSetString(player, planetId, 'release', strings);
    return true;
}

/**
 * The stellars a NEW pilot starts dominating: every one whose spöb Flags2
 * 0x0020 says "Stellar is always dominated (all your base are belong to
 * us)" (PlanetDominationData.alwaysDominated), sorted. No stock stellar
 * sets it. GUESS (unmeasured, #353): such a stellar is simply dominated from
 * the start — it pays tribute and can be Released like any other, and its
 * OnDominate does not run (the player never dominated it). A pilot created
 * before the plug-in was installed does not gain it.
 */
export function alwaysDominatedStellars(planets: Iterable<{
    id: string, domination: { alwaysDominated: boolean },
}>): string[] {
    return [...planets].filter(planet => planet.domination.alwaysDominated)
        .map(planet => planet.id).sort();
}
