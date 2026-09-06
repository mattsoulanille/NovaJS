import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from './bay_plugin.js';
import { MissionShipComponent } from './mission_ship_plugin.js';
import { PlayerEscortComponent } from './player_escort.js';

/**
 * ============================================================================
 * The escort cap (maintainer ruling #161)
 * ============================================================================
 *
 * A player may have at most SIX escorts, and the six are the escorts the
 * player has HIRED (at the bar) or CAPTURED (boarded and kept). Nothing
 * else counts, and nothing else is limited:
 *
 *   - escorts a MISSION grants (mïsn ShipBehav 1 / escort-goal ships that
 *     fly in formation on the player) join regardless of the cap and are
 *     not counted against it — they belong to the mission, not the player
 *     (see escortsOnPayroll in player_escort_plugin.ts for the same line);
 *   - fighters LAUNCHED FROM BAYS — the player's own or a carrier
 *     escort's — are outfits flying, not escorts, and are unlimited.
 *
 * The cap is enforced at the two places an escort is acquired, with the
 * same refusal (STR# 2002 index 123): the bar's hire dialog
 * (spaceport/hire_escort.ts) and the plunder session's "keep as escort"
 * (boarding_plugin.ts). Both count through the predicates here so they
 * cannot drift.
 *
 * The original refuses a hire past a cap but the Bible never states the
 * number; six is the maintainer's ruling from the original game.
 */
export const MAX_ESCORTS = 6;

/** STR# 2002 index 123, verbatim, as the fallback for a short table. */
export const MAX_ESCORTS_MESSAGE =
    'You already have the maximum possible number of escorts.';

/**
 * Whether a ship that is (or is about to be) the player's escort counts
 * against {@link MAX_ESCORTS}: a hired or captured escort does; a mission
 * ship and a bay fighter do not. Reads the synced identity components,
 * which is what makes the sim-side count deterministic on every peer.
 */
export function countsTowardEscortCap(escort: Entity): boolean {
    return !escort.components.has(BayFighterComponent)
        && !escort.components.has(MissionShipComponent);
}

/**
 * The escorts of `player` in the world that count against the cap: every
 * entity carrying the durable PlayerEscortComponent for that player (hired
 * escorts, captured prizes — and a carrier escort's own wing, which
 * countsTowardEscortCap then drops as bay fighters). Order-independent, so
 * safe to derive from any entity iteration.
 */
export function cappedEscortsInWorld(entities: Iterable<[string, Entity]>,
    player: string): number {
    let count = 0;
    for (const [, escort] of entities) {
        if (escort.components.get(PlayerEscortComponent)?.player !== player) {
            continue;
        }
        if (countsTowardEscortCap(escort)) {
            count++;
        }
    }
    return count;
}
