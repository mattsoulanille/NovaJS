import { Entities, UUID } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import {
    DamagedEvent, DisabledComponent, FiringGroupComponent, OwnerComponent,
    ShieldComponent, ShipComponent, SourceComponent,
} from '../ship/index.js';
import { GovtComponent, SimulationGameDataResource } from '../core/index.js';
import { NpcComponent } from './npc_component.js';
import { sameFlock } from './allegiance.js';
import { addDamageLoad } from './npc_retreat.js';

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

/** How many SourceComponent hops responsibleShip follows from a weapon
 * to the ship that fired it: a submunition names its parent projectile, a
 * sub of a sub that one's, and so on. Stock and plug-in sub chains are a
 * few generations deep; the bound only stops a malformed cycle. */
const MAX_SOURCE_HOPS = 8;

/**
 * The SHIP responsible for a weapon entity's hit (a DamagedEvent's
 * `damager`: a projectile, beam or blast), for an NPC's aggressor record.
 *
 *  1. The weapon's FIRING-GROUP ROOT (FiringGroupComponent.group) when that
 *     ship is still in the world: a lone ship's own uuid, a fleet's leader,
 *     the carrier (or the carrier's fleet leader) for a bay fighter's shots,
 *     the player for a hired escort's or player fighter's. The same answer
 *     the player-side hostility (aggression_plugin's damagerRoot), kill
 *     credit (DamageAttributionSystem) and a guided lock's provocation
 *     (flock.ts's provokeGuidedLock, which already wrote the root into
 *     npc.aggressor) give, so "who is attacking me" has one answer for a
 *     whole flock. Recording the concrete firer instead made a ship fighting
 *     a carrier alternate between the carrier (its missile lock, its own
 *     guns) and each bay fighter (their guns) hit by hit, and a fleeing
 *     trader swung its flee heading to each in turn.
 *  2. Else its owner-chain root (OwnerComponent.owner) if still in the
 *     world.
 *  3. Else the firing ship itself, walking SourceComponent through any
 *     parent projectiles: a SUBMUNITION's SourceComponent is the projectile
 *     it split from (fire_weapon_plugin's fireSubs), and recording that
 *     verbatim left aggressors like `nova:443:projectile:243` behind,
 *     which no ship query ever matches (the trader stopped reacting, then
 *     the next think forgot it). Stops at the first ship: a bay fighter
 *     carries a SourceComponent of its own (its carrier).
 *
 * A root or owner that has left the world (a fleet whose leader died, whose
 * escorts still share its group) or lies disabled (a hulked carrier whose
 * fighters fight on) falls through to the concrete firer, so the victim
 * still has a live attacker to flee from or fight: the decision step never
 * treats a hulk as one. Undefined when
 * nothing resolves to an entity in the world (a sub whose parent and firer
 * are both gone): the caller then keeps the aggressor it had.
 *
 * Pure over synced, serializer-registered components, so every peer
 * reaches the same answer.
 */
export function responsibleShip(damager: Entity | undefined,
    getEntity: (uuid: string) => Entity | undefined): string | undefined {
    if (!damager) {
        return undefined;
    }
    const active = (uuid: string | undefined) => {
        const entity = uuid !== undefined ? getEntity(uuid) : undefined;
        return entity !== undefined
            && !entity.components.has(DisabledComponent);
    };
    const group = damager.components.get(FiringGroupComponent)?.group;
    if (active(group)) {
        return group;
    }
    const owner = damager.components.get(OwnerComponent)?.owner;
    if (active(owner)) {
        return owner;
    }
    let source = damager.components.get(SourceComponent);
    for (let hop = 0; hop < MAX_SOURCE_HOPS && source !== undefined; hop++) {
        const entity = getEntity(source);
        if (!entity) {
            return undefined;
        }
        const next = entity.components.get(SourceComponent);
        if (entity.components.has(ShipComponent) || next === undefined) {
            return source;
        }
        source = next;
    }
    return undefined;
}

/**
 * Records who last damaged an NPC. The damager of a DamagedEvent is
 * the projectile/beam/blast entity; the ship recorded is the one
 * responsibleShip resolves it to (the firing group's root while it lives).
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
    args: [DamagedEvent, NpcComponent, UUID, Entities,
        Optional(GovtComponent), Optional(ShieldComponent), TimeResource,
        SimulationGameDataResource] as const,
    step({ damager, damage, scale = 1 }, npc, uuid, entities,
        govt, shield, time, gameData) {
        const getEntity = (id: string) => entities.get(id);
        const source = responsibleShip(entities.get(damager), getEntity);
        if (source && !sameFlock(source, uuid, getEntity)) {
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
