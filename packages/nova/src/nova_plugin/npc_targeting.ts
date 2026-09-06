import { RunQuery, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { DamagedEvent } from './death_plugin.js';
import { NpcComponent } from './npc_component.js';
import { SourceComponent } from './weapon_components.js';

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
 * the projectile/beam entity; its SourceComponent is the firing ship.
 */
export const NpcAggressionSystem = new System({
    name: 'NpcAggressionSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, NpcComponent, UUID, RunQuery] as const,
    step({ damager }, npc, uuid, runQuery) {
        const source = runQuery(DamagerSourceQuery, damager)[0]?.[0];
        if (source && source !== uuid) {
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
