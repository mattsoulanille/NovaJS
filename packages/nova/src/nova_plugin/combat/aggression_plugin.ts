import { GetEntity, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import {
    AggressionComponent, AggressionState, applyAggression, sweepAggression,
} from './aggression.js';
import { DamagedEvent } from '../ship/index.js';
import { SourceComponent } from '../ship/index.js';
import { FiringGroupComponent } from '../ship/index.js';
import { ControlledByComponent } from '../player/index.js';
import { ShipComponent } from '../ship/index.js';
import { TargetComponent } from '../ship/index.js';

/**
 * ============================================================================
 * Recording aggression against player ships
 * ============================================================================
 *
 * The three triggers of Matthew's rule, and where each is caught:
 *
 *  (a) A GUIDED MISSILE LOCKED ONTO US, at launch. Caught in
 *      flock.ts's provokeGuidedLock — the projectile spawn path that
 *      already treats a guided lock as an act of war against NPCs, so
 *      NPC and player victims are provoked by one call at one instant.
 *      No damage required and none is credited.
 *
 *  (b) A DAMAGING HIT WHILE THE SHOOTER WAS TARGETING US, and
 *  (c) ENOUGH CUMULATIVE DAMAGE WHILE IT WAS NOT.
 *      Both caught here, in AggressionDamageSystem, off DamagedEvent —
 *      the single authoritative damage-application event that
 *      projectiles, beams and blasts all funnel through.
 *
 * WHAT "DOES DAMAGE" MEANS (b). The hit must carry positive shield or
 * armor damage: a pure-ionization or pure-knockback tap is not "a
 * projectile that does damage". We deliberately do NOT require the
 * victim's armor to actually drop afterwards. A shot fully absorbed by
 * shields is still a damaging hit — the pilot certainly experienced it
 * as one — and, more importantly, reading post-application health would
 * make this system's verdict depend on whether it happened to run
 * before or after DamageSystem for the same event. The event's own
 * numbers are ordering-independent, and therefore identical on every
 * peer.
 *
 * BEAMS. Matthew's rule says "projectile" for trigger (b), and beams
 * are their own weapon class in Nova — but they arrive here as ordinary
 * DamagedEvents and there is no defensible reading in which being cut
 * open by a beam that is deliberately tracking you is less hostile than
 * being shot. Beams therefore count for (b) as well as (c). The
 * distinction the rule is really drawing is between a deliberate,
 * damaging attack and a stray one, and that is exactly what the
 * shooter's TargetComponent decides.
 *
 * ATTRIBUTION. DamagedEvent's `damager` is the weapon entity, not the
 * ship. Who is responsible follows the SAME rule the reputation system
 * uses for kill credit (DamageAttributionSystem): the weapon's
 * firing-group root when it has one — so an escort's or bay fighter's
 * shots mark its leader, and a blast (which carries only the group)
 * still resolves — else the firing ship named by SourceComponent.
 *
 * NOTHING HERE CHANGES NPC BEHAVIOR: npc.aggressor and the NPC AI's
 * hostility rules are untouched. This layer only answers "how does the
 * player's own ship stand toward that one".
 */

const DamagerQuery = new Query([Optional(FiringGroupComponent),
    Optional(SourceComponent)] as const);

/**
 * The ship responsible for a weapon entity's damage: its firing-group
 * root, else the firing ship. Deliberately identical to
 * reputation_plugin's DamageAttributionSystem so "who shot me" has one
 * answer across kill credit and hostility.
 */
export function damagerRoot(
    result: readonly [{ group: string } | undefined, string | undefined]
        | undefined): string | undefined {
    if (!result) {
        return undefined;
    }
    const [group, source] = result;
    return group?.group ?? source;
}

/** Total health damage a hit delivers, as the event describes it. */
export function hitDamage(damage: { shield: number, armor: number },
    scale = 1): number {
    return Math.max(0, damage.shield * scale) + Math.max(0, damage.armor * scale);
}

const AggressorTargetQuery = new Query([Optional(TargetComponent)] as const);

const AggressionDamageSystem = new System({
    name: 'AggressionDamageSystem',
    events: [DamagedEvent],
    // Gated on ControlledByComponent (a player's ship) and
    // ShipComponent: projectiles and asteroids take damage too, and
    // neither has an opinion about who shot it.
    args: [DamagedEvent, ShipComponent, ControlledByComponent, UUID,
        GetEntity, TimeResource, RunQuery] as const,
    step({ damage, damager, scale = 1 }, _ship, _controlledBy, uuid, victim,
        time, runQuery) {
        const aggressor = damagerRoot(runQuery(DamagerQuery, damager)[0]);
        if (!aggressor || aggressor === uuid) {
            return;
        }
        const dealt = hitDamage(damage, scale);
        if (dealt <= 0) {
            // No shield or armor damage: ionization and knockback alone
            // are not "a projectile that does damage".
            return;
        }
        // Trigger (b) vs (c): was the shooter aiming at US? Read off the
        // aggressor's own synced TargetComponent, so every peer draws
        // the same conclusion from the same tick's state.
        const targetingUs = runQuery(AggressorTargetQuery, aggressor)[0]?.[0]
            ?.target === uuid;
        applyAggression(victim, aggressor, time.time, {
            damage: dealt,
            deliberate: targetingUs,
        });
    },
});

/**
 * Lapses aggression back to neutral. A pair goes neutral once
 * AGGRESSION_WINDOW_MS of sim time has passed with no aggressive act,
 * and the whole entry is dropped — which is what resets the
 * stray-damage accumulator, so forgiveness is complete rather than
 * leaving a primed grudge behind (see sweepAggression).
 *
 * A sweep is not strictly required for correctness — isRecentAggressor
 * makes the same time comparison, so the predicate would lapse on its
 * own — but it is required for hygiene: without it the map would grow
 * for the whole flight, riding in every snapshot and wire baseline, and
 * the accumulator would never reset. The two use the same strict
 * comparison against the same constant, so they lapse on exactly the
 * same tick.
 *
 * The component is removed once empty so a ship that has been left
 * alone for half a minute carries no aggression state at all.
 */
const AggressionSweepSystem = new System({
    name: 'AggressionSweepSystem',
    args: [AggressionComponent, TimeResource, GetEntity] as const,
    step(state: AggressionState, time, entity) {
        if (!sweepAggression(state, time.time)) {
            entity.components.delete(AggressionComponent);
        }
    },
    // Determinism rule 4: the lapse compares against time.time, so this
    // must run after TimeSystem has advanced the clock this tick.
    // Otherwise a peer whose toposort placed it first would hold a
    // grudge one tick longer than its neighbour.
    after: [TimeSystem],
});

export const AggressionPlugin: Plugin = {
    name: 'AggressionPlugin',
    build(world) {
        // Serializer registration is MANDATORY, not optional polish:
        // this component changes simulation behavior (which ship 'r'
        // retargets to) and is read by display code (the target
        // corners), and the simulation->display bridge silently DROPS
        // unregistered components. Registering it also puts it in the
        // desync hash, rollback snapshots, and wire baselines, which is
        // exactly right for state the sim reads.
        world.resources.get(SerializerResource)
            ?.addComponent(AggressionComponent, AggressionState);
        world.addSystem(AggressionDamageSystem);
        world.addSystem(AggressionSweepSystem);
    },
    remove(world) {
        world.removeSystem(AggressionSweepSystem);
        world.removeSystem(AggressionDamageSystem);
    },
};
