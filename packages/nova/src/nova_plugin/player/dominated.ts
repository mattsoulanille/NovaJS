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
