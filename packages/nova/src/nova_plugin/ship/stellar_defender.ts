import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { SourceComponent } from './weapon_components.js';

/**
 * ============================================================================
 * A stellar's DEFENCE SHIP (spöb DefenseDude / DefCount; #353 section 1)
 * ============================================================================
 *
 * The marker on a ship a stellar launched against the players demanding
 * tribute from it (encounters/tribute.ts's DefenseFleetSystem). It lives in
 * the ship domain because the rules it switches off sit low in the stack:
 *
 *  - it is NEVER DISABLED (Matthew's ruling on #353: "Defence fleet ships
 *    can not be disabled (they ignore the disabledAt number). This does
 *    not apply to carried ships they launch from their bays."):
 *    encounters/disabled_plugin.ts's ShipDisableSystem skips it, so it
 *    fights on until its armor is gone;
 *  - its kill costs NO legal record and adds NO combat rating, nor does a
 *    kill of a fighter it launched (MEASURED, reference "Tribute (R18),
 *    wave 39", finding 7: the record read -600 after the fleet answer and
 *    two kills, the rating stayed 12,800 throughout):
 *    reputation/reputation_plugin.ts's credit systems skip
 *    {@link isDefenceFleetShip};
 *  - its brain is the defence fleet's (npc/npc_decision.ts's
 *    defenderDecision): it attacks only the players dominating its stellar
 *    and their escorts, unless something else provokes it.
 *
 * `planet` is the stellar ENTITY's uuid (`planet <spöb id>`, make_system's
 * naming), whose DefenseFleet component (travel/defense_fleet.ts) holds
 * the demanders. `player`, while set, is the demander this ship is
 * assigned to (the ruling's "an equal (if possible) number of ships should
 * prioritize attacking each player"); absent, the fleet has stood down and
 * the ship is flying home to land.
 *
 * Serializer- and delta-registered (encounters/tribute.ts's TributePlugin):
 * the IFF on every display reads it (combat/hostility.ts).
 */
export const StellarDefenderType = t.intersection([
    t.type({
        /** The launching stellar's entity uuid. */
        planet: t.string,
    }),
    t.partial({
        /** The demander this ship is assigned to; absent: going home. */
        player: t.string,
    }),
]);
export type StellarDefender = t.TypeOf<typeof StellarDefenderType>;
export const StellarDefenderComponent =
    new Component<StellarDefender>('StellarDefender');

/**
 * Whether `entity` belongs to a stellar's defence fleet: a defence ship
 * itself, or a ship launched from one's bays (its SourceComponent names
 * the carrier). Neither one's kill or disable is charged to anyone's legal
 * record or combat rating (see the module comment). A carried fighter is
 * otherwise an ordinary bay fighter: it can be disabled and does not count
 * against the fleet's cap.
 *
 * Pure over synced components (SourceComponent and the marker cross the
 * wire), so every peer agrees.
 */
export function isDefenceFleetShip(entity: Entity | undefined,
    getEntity: (uuid: string) => Entity | undefined): boolean {
    if (!entity) {
        return false;
    }
    if (entity.components.has(StellarDefenderComponent)) {
        return true;
    }
    const carrier = entity.components.get(SourceComponent);
    return carrier !== undefined
        && getEntity(carrier)?.components.has(StellarDefenderComponent)
        === true;
}
