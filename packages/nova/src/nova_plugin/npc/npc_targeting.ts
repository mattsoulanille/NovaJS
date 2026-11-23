import { Entities, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { DamagedEvent } from '../ship/index.js';
import { NpcComponent } from './npc_component.js';
import { sameFlock } from './allegiance.js';
import { SourceComponent } from '../ship/index.js';

/**
 * Target selection primitives shared by the NPC decision step: the
 * deterministic nearest-candidate rule and the aggressor bookkeeping
 * that feeds it.
 */

/**
 * A candidate hostile for target selection: uuid plus its squared
 * distance. Selection picks the nearest; exactly equal distances break
 * ties by the lexicographically smaller uuid so every peer picks the
 * same target regardless of entity-map iteration order (the same rule
 * ChooseTargetSystem uses).
 */
export function chooseNearest(
    candidates: Iterable<readonly [string, number]>): string | undefined {
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const [uuid, distanceSquared] of candidates) {
        if (distanceSquared < bestDistance
            || (distanceSquared === bestDistance
                && best !== undefined && uuid < best)) {
            best = uuid;
            bestDistance = distanceSquared;
        }
    }
    return best;
}

// --- Aggression tracking ---

const DamagerSourceQuery = new Query([Optional(SourceComponent)] as const);

/**
 * Records who last damaged an NPC. The damager of a DamagedEvent is
 * the projectile/beam/blast entity; its SourceComponent is the firing ship.
 *
 * Never a ship of the victim's OWN FLOCK (allegiance.ts's sameFlock). Direct
 * hits pass through a flock, but damage from inside it still lands: a blast
 * whose weapon hurts its firing ship carries no firing group and splashes
 * every ship in its radius (BLAST_FLOCK_RULE, ship/firing_group.ts), and a
 * DISABLED fleetmate forfeits group immunity. Recording that firer here made
 * a warship parent hunt its own escort or bay fighter for a missile that
 * burst beside it (Matthew's report, 2026-11-23).
 */
export const NpcAggressionSystem = new System({
    name: 'NpcAggressionSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, NpcComponent, UUID, RunQuery, Entities] as const,
    step({ damager }, npc, uuid, runQuery, entities) {
        const source = runQuery(DamagerSourceQuery, damager)[0]?.[0];
        if (source && !sameFlock(source, uuid, id => entities.get(id))) {
            npc.aggressor = source;
            // React at the next think, not next frame: reaction time.
            // A bribe (hail beg-for-mercy) only lasts "until the player
            // provokes them again": if the briber is the one now shooting
            // us, the reprieve is void — clear it so NpcDecisionSystem stops
            // skipping them and resumes hostility.
            if (npc.pacifiedFrom === source) {
                npc.pacifiedFrom = undefined;
                npc.pacifiedUntil = undefined;
            }
        }
    },
});
