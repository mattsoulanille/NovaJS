import { Entities, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { DamagedEvent, ShieldComponent } from '../ship/index.js';
import { GovtComponent, SimulationGameDataResource } from '../core/index.js';
import { NpcComponent } from './npc_component.js';
import { sameFlock } from './allegiance.js';
import { addDamageLoad } from './npc_retreat.js';
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
 *
 * Also keeps the DAMAGE LOAD a gövt Flags 0x0010 warship's retreat reads
 * (npc_retreat.ts): each such hit adds its damage, as a fraction of the
 * ship's max shield, to a leaky bucket. Only flagged AI 3 ships carry it,
 * so no other NPC's synced state changes. A hit counts the larger of its
 * shield and armor damage: roughly what it takes off whichever layer it
 * lands on, without depending on whether DamageSystem has applied it yet.
 */
export const NpcAggressionSystem = new System({
    name: 'NpcAggressionSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, NpcComponent, UUID, RunQuery, Entities,
        Optional(GovtComponent), Optional(ShieldComponent), TimeResource,
        SimulationGameDataResource] as const,
    step({ damager, damage, scale = 1 }, npc, uuid, runQuery, entities,
        govt, shield, time, gameData) {
        const source = runQuery(DamagerSourceQuery, damager)[0]?.[0];
        if (source && !sameFlock(source, uuid, id => entities.get(id))) {
            npc.aggressor = source;
            // getCached is deterministic here for the reason
            // npc_decision.ts's lookupGovt gives: every assigned govt is
            // staged.
            if (npc.aiType === 3 && shield && shield.max > 0 && govt
                && gameData.data.Govt.getCached(govt.id)
                    ?.flags.warshipsRetreatAt25) {
                const dealt = Math.max(0, damage.shield * scale,
                    damage.armor * scale);
                addDamageLoad(npc, dealt / shield.max, time.time);
            }
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
