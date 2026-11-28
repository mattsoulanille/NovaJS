import { RunQuery } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { Query } from 'nova_ecs/query';
import { World } from 'nova_ecs/world';
import { engineLimitsOf } from '../core/index.js';
import { ControlledByComponent } from '../player/index.js';
import { ShipComponent } from './ship_plugin.js';

/**
 * ============================================================================
 * The system ship cap (EVN Bible Part I, "Max Ships In System 64")
 * ============================================================================
 *
 * MEASURED (docs/reference_experiments.md, "The ship cap, beamcap (wave
 * 60)"): the original's bay launches and mission ships stop at 55 ships
 * BESIDES THE PLAYER (an empty system took 55 fighters, twice; one with 31
 * targets took 24 more; three 31-ship missions placed exactly 55), and a
 * refused launch keeps its fighter: the next press after a slot frees
 * launches one. A planet's defence fleet is NOT held by that count: with
 * 55 fighters out, all six defenders of a demand launched (62 ships).
 *
 * So two numbers per room rule (core/engine_limits.ts ShipCaps):
 *  - `others`: ships that are not a pilot's own (NPCs, escorts, bay
 *    fighters, defenders, hulks) at which a new NPC arrival (traffic, a
 *    fleet, reinforcements, a person; spawn/npc_spawn_plugin.ts) and a bay
 *    launch (escorts/bay_plugin.ts) are refused. The bay keeps its
 *    fighter: a refused launch is a refused shot, and the firing loop
 *    takes no ammo for it.
 *  - `total`: every ship in the system, at which a planet's defender
 *    (spawn/defense_fleet_system.ts launchDefender) is refused, as is any
 *    other spawn: it does not launch, and the fleet tries again at its
 *    next launch. GUESS: the Bible's 64 (the defenders got past 55; the
 *    64 itself was not reached).
 *
 * Matthew (2026-11-27) remembered a planet-domination tactic, "fill the
 * system with escorts and launched fighters so none of the defense fleet
 * can be spawned"; the measurement says fighters alone cannot do it on the
 * original (the defenders came out past them), and whether a fleet that
 * cannot launch at all counts as beaten was not reached. NovaJS keeps the
 * domination rule as it was: the fleet must be beaten.
 *
 * Never refused: a pilot's own ship and whatever its client inserts as an
 * input record (escorts, mission ships): a world refusing a peer's record
 * would strand that peer. GUESS for the original's escorts (not measured);
 * the original's MISSION ships are refused at 55, which NovaJS does not do
 * yet (they arrive through the owner's addEntity record, and a refusal
 * there would need the mission's ledger to know).
 *
 * Deterministic: the counts are the world's own ship entities through a
 * cached query and the rule is synced room state.
 */

const LiveShips = new Query([ShipComponent, Optional(ControlledByComponent)] as const,
    'LiveShipsWithController');

/** Which count a new ship is held by (see the module comment). */
export type ShipSpawnKind = 'npc' | 'defender';

/**
 * Whether the system has room for one more ship that the simulation
 * itself adds: an NPC or bay fighter (`npc`, held by ShipCaps.others) or a
 * planet's defender (`defender`, held by ShipCaps.total).
 */
export function shipSlotFree(world: World, kind: ShipSpawnKind = 'npc')
    : boolean {
    const runQuery = world.resources.get(RunQuery);
    if (!runQuery) {
        return true;
    }
    const caps = engineLimitsOf(world.entities).ships;
    const ships = runQuery(LiveShips);
    if (ships.length >= caps.total) {
        // The ceiling for every kind.
        return false;
    }
    if (kind === 'defender') {
        return true;
    }
    let others = 0;
    for (const [, controlledBy] of ships) {
        if (!controlledBy) {
            others++;
        }
    }
    return others < caps.others;
}
