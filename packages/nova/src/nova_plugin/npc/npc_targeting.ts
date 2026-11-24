import { Entities, UUID } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import {
    DamagedEvent, DisabledComponent, FiringGroupComponent, OwnerComponent,
    ShieldComponent, ShipComponent, SourceComponent, TargetComponent,
} from '../ship/index.js';
import { GovtComponent, SimulationGameDataResource } from '../core/index.js';
import { ControlledByComponent } from '../player/index.js';
import { govtDisposition } from '../reputation/index.js';
import { NpcComponent } from './npc_component.js';
import { flockPlayer, sameFlock } from './allegiance.js';
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
 *     the carrier (or the carrier's fleet leader) for a bay fighter's shots.
 *     The same answer kill credit (DamageAttributionSystem) gives, so "who
 *     is attacking me" has one answer for a whole NPC flock. Recording the
 *     concrete firer instead made a ship fighting a carrier alternate
 *     between the carrier (its missile lock, its own guns) and each bay
 *     fighter (their guns) hit by hit, and a fleeing trader swung its flee
 *     heading to each in turn.
 *     EXCEPT A PLAYER'S FLOCK (the root is a player's ship or flies in a
 *     player's flock): there the ship that actually fired is the aggressor
 *     (playerSideAggressor). Reference "A trader shot by the player's
 *     escort, wave 12": a trader the player's escort attacked fought (and
 *     fled) the ESCORT and never fired at the player beside it. Kill
 *     credit, legal records and the player-side aggression record (the
 *     IFF) still go to the root.
 *  2. Else its owner-chain root (OwnerComponent.owner) if still in the
 *     world (the same player's-flock exception applies).
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
    const owner = damager.components.get(OwnerComponent)?.owner;
    const root = active(group) ? group : active(owner) ? owner : undefined;
    if (root === undefined) {
        return firingShip(damager, getEntity);
    }
    if (isPlayerSideShip(root, getEntity)) {
        return playerSideAggressor(firingShip(damager, getEntity), getEntity)
            ?? root;
    }
    return root;
}

/**
 * Whether `uuid` is on a player's side: a player's ship, or a ship in a
 * player's flock (allegiance.ts's flockPlayer: hired escorts, bay
 * fighters, a protecting special ship). The same test as
 * aggression_plugin's isPlayerSide, which lives above npc.
 */
export function isPlayerSideShip(uuid: string,
    getEntity: (uuid: string) => Entity | undefined): boolean {
    return getEntity(uuid)?.components.has(ControlledByComponent) === true
        || flockPlayer(uuid, getEntity) !== undefined;
}

/**
 * The ship an NPC records as its aggressor when the ship that fired at it
 * (`firer`, a firingShip answer) flies on a PLAYER's side: that ship
 * itself — a hired escort, a protecting special ship, the player — so the
 * victim fights or flees the escort that attacked it, not the player
 * (reference "A trader shot by the player's escort, wave 12").
 *
 * A BAY FIGHTER (a ship whose SourceComponent names the ship that launched
 * it) answers for its CARRIER while the carrier is in the world and not
 * disabled: the player's own fighters for the player, an escort carrier's
 * fighters for that escort. Unmeasured; chosen because a fighter is a
 * weapon its carrier fires (a wëap, launched and recalled like ammunition,
 * the same reason a guided missile's lock provokes against its firer), and
 * because it keeps the NPC-carrier rule's one-aggressor-per-carrier
 * answer: recording each fighter in turn is what made a trader swing its
 * flee heading from fighter to fighter (npc_aggressor_attribution_test).
 *
 * Undefined when `firer` is undefined (the chain left the world).
 */
export function playerSideAggressor(firer: string | undefined,
    getEntity: (uuid: string) => Entity | undefined): string | undefined {
    if (firer === undefined) {
        return undefined;
    }
    const carrier = getEntity(firer)?.components.get(SourceComponent);
    const carrierEntity = carrier !== undefined
        ? getEntity(carrier) : undefined;
    if (carrierEntity?.components.has(ShipComponent)
        && !carrierEntity.components.has(DisabledComponent)) {
        return carrier;
    }
    return firer;
}

/**
 * The ship that actually fired a weapon entity: its SourceComponent,
 * followed through any parent projectiles (a submunition names the
 * projectile it split from) to the first ship. Undefined once the chain
 * leaves the world. See responsibleShip.
 */
export function firingShip(damager: Entity,
    getEntity: (uuid: string) => Entity | undefined): string | undefined {
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
 * Whether a hit on `victim` was AIMED at it: the weapon itself was fired
 * at it (its TargetComponent, set at fire time and carried by guided and
 * unguided shots alike, and by a submunition from its parent), or the ship
 * that fired it, or that ship's flock root (`responsible`), is targeting it
 * now. Not a blast's own call: a blast carries no target, so it is
 * deliberate when its firer is after the victim.
 */
export function aimedAt(victim: string, damager: Entity,
    responsible: string,
    getEntity: (uuid: string) => Entity | undefined): boolean {
    const targets = (entity: Entity | undefined) =>
        entity?.components.get(TargetComponent)?.target === victim;
    if (targets(damager) || targets(getEntity(responsible))) {
        return true;
    }
    const firer = firingShip(damager, getEntity);
    return firer !== undefined && targets(getEntity(firer));
}

/**
 * Records who last damaged an NPC. The damager of a DamagedEvent is
 * the projectile/beam/blast entity; the ship recorded is the one
 * responsibleShip resolves it to (the firing group's root while it lives,
 * the ship that fired for a player's flock).
 *
 * Only an ATTACK is recorded, not every hit (provokes, below):
 *  - a hit AIMED at this ship (aimedAt: the shot, its firer or the firer's
 *    flock root targets it);
 *  - any hit from a player's side (a player's ship, or a ship in a
 *    player's flock), deliberate or stray, exactly as before: the
 *    player-side rules are not this change's to move;
 *  - any hit from a ship whose government this ship's government already
 *    counts as an ENEMY (govtDisposition): it is at war with the shooter,
 *    so a stray from it is still an enemy's fire. (Not measured; no
 *    reference run had a hostile-govt bystander.)
 * A STRAY from anyone else (its own government, an ally, a neutral, firing
 * at somebody else) provokes nothing. Reference "NPC friendly fire wave
 * 10" (docs/reference_experiments.md): a ship hit for about 45 s by bolts,
 * a beam or a blast aimed at the player, from a ship of its own, an
 * allied or a neutral government, never fired back. Recording those
 * strays made two same-govt warships fight each other over one bolt.
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
        const weapon = entities.get(damager);
        const source = responsibleShip(weapon, getEntity);
        if (source && weapon && !sameFlock(source, uuid, getEntity)) {
            // getCached is deterministic here for the reason
            // npc_decision.ts's lookupGovt gives: every assigned govt is
            // staged.
            const govtData = govt
                ? gameData.data.Govt.getCached(govt.id) : undefined;
            // The damage load counts every hit, stray or not: it measures
            // how badly the fight is going, not who started it.
            if (npc.aiType === 3 && shield && shield.max > 0
                && govtData?.flags.warshipsRetreatAt25) {
                const dealt = Math.max(0, damage.shield * scale,
                    damage.armor * scale);
                addDamageLoad(npc, dealt / shield.max, time.time);
            }
            const shooterGovt = getEntity(source)
                ?.components.get(GovtComponent);
            const provokes = aimedAt(uuid, weapon, source, getEntity)
                || getEntity(source)?.components.has(ControlledByComponent)
                || flockPlayer(source, getEntity) !== undefined
                || govtDisposition(govtData, shooterGovt
                    ? gameData.data.Govt.getCached(shooterGovt.id)
                    : undefined) === 'enemy';
            if (!provokes) {
                return;
            }
            // React at the next think, not next frame: reaction time.
            npc.aggressor = source;
            // A bribe (hail beg-for-mercy) only lasts "until the player
            // provokes them again": if the briber, or a ship of the
            // briber's flock, is the one now shooting us, the reprieve is
            // void — clear it so NpcDecisionSystem stops skipping them and
            // resumes hostility. (The flock half keeps what the reprieve
            // did when an escort's hit was recorded as the player's.)
            if (npc.pacifiedFrom !== undefined
                && (npc.pacifiedFrom === source
                    || flockPlayer(source, getEntity) === npc.pacifiedFrom)) {
                npc.pacifiedFrom = undefined;
                npc.pacifiedUntil = undefined;
            }
        }
    },
});
