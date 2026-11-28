import { RunQuery } from 'nova_ecs/arg_types';
import { Query } from 'nova_ecs/query';
import { World } from 'nova_ecs/world';
import { engineLimitsOf } from '../core/index.js';
import { ShipComponent } from './ship_plugin.js';

/**
 * ============================================================================
 * Max Ships In System (EVN Bible, Part I: 64)
 * ============================================================================
 *
 * The room's `limits` rule (core/engine_limits.ts EngineLimits.ships) caps
 * the ships in a system. While it is full, a NEW ship that the simulation
 * itself would add is refused, and nothing that is already there is
 * removed:
 *  - an NPC's arrival (traffic, a fleet's lead or escort, reinforcements;
 *    spawn/npc_spawn_plugin.ts spawnNpc / spawnFleet): it does not appear;
 *  - a planet's defender (spawn/defense_fleet_system.ts launchDefender):
 *    it does not launch, and the fleet tries again on its next launch;
 *  - a bay launch (escorts/bay_plugin.ts BayWeaponEntry.fire): the launch
 *    is refused like a shot at a full table, so the bay keeps its fighter
 *    (the firing loop takes no ammo for a refused shot).
 * Matthew (2026-11-27): "Bay ammo is not consumed when the system ship
 * limit is reached and a spawn is refused. One tactic for dominating
 * planets is to fill the system with escorts and launched fighters so none
 * of the defense fleet can be spawned."
 *
 * A pilot's own ship (and whatever its client inserts with it, its
 * escorts) is never refused: a peer's insertion is an input record, and a
 * world refusing a player's hull would strand that peer.
 *
 * Every ship counts: players, escorts, bay fighters, NPCs, defenders, a
 * disabled hulk, one in its death throes until it is gone.
 *
 * Deterministic: the count is the world's own ship entities through a
 * cached query and the rule is synced room state.
 */

const LiveShips = new Query([ShipComponent] as const, 'LiveShips');

/**
 * Whether the system has room for one more ship that the simulation
 * itself adds (an NPC, a defender, a bay fighter), under the room's rule.
 */
export function shipSlotFree(world: World): boolean {
    const runQuery = world.resources.get(RunQuery);
    if (!runQuery) {
        return true;
    }
    return runQuery(LiveShips).length < engineLimitsOf(world.entities).ships;
}
