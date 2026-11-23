import { Entity } from 'nova_ecs/entity';
import { FiringGroupComponent, firingImmune, victimFiringGroup } from '../ship/index.js';
import { OwnerComponent } from '../ship/index.js';
import { applyAggression, isInFlock, NpcComponent } from '../npc/index.js';

/**
 * The player's flock — flockParent, isInFlock and MAX_FLOCK_DEPTH — lives in
 * npc/allegiance.ts, so the NPC decision step can ask the same question the
 * target brackets do; it is re-exported here for its many combat callers.
 */
export { flockParent, isInFlock, MAX_FLOCK_DEPTH } from '../npc/index.js';

/**
 * Guided-missile provocation: locking a GUIDED missile onto a ship is
 * itself an act of war — the moment the missile spawns with a target,
 * that target turns hostile to the shooter (a brave trader fights
 * back, a wimpy trader runs, a warship engages), no damage required.
 * Called from the projectile spawn path (deterministic sim event on
 * every peer), NOT from the hit handler.
 *
 * Exempt: the shooter's own transitive flock (escorts and fighters —
 * a stray lock on your own wing is not a betrayal) and anything in
 * the shooter's firing group (fleetmates; the same immunity that
 * makes their shots pass through each other).
 *
 * Against an NPC the effect is the NPC aggression channel
 * (npc.aggressor), with the think timer zeroed so the reaction is
 * immediate rather than waiting out the current decision interval.
 * Against a PLAYER's ship — which has no NPC brain to provoke — it is
 * trigger (a) of the behavioral aggression rule (aggression.ts): the
 * shooter is hostile to that player for the next 30 seconds. A ship
 * can be neither (an unmanned hulk), in which case there is simply
 * nobody to provoke; `now` is the sim clock in milliseconds.
 */
export function provokeGuidedLock(target: string, source: string | undefined,
    ownerRoot: string,
    getEntity: (uuid: string) => Entity | undefined, now: number): void {
    const victim = getEntity(target);
    if (!victim) {
        return;
    }
    if (isInFlock(target, ownerRoot, getEntity)) {
        return;
    }
    const shooter = source ? getEntity(source) : undefined;
    const shooterGroup = shooter?.components.get(FiringGroupComponent)?.group
        ?? ownerRoot;
    const victimGroup = victimFiringGroup(
        victim.components.get(FiringGroupComponent),
        victim.components.get(OwnerComponent)?.owner, target);
    if (firingImmune(shooterGroup, victimGroup, undefined, undefined)) {
        return;
    }
    // ONE answer for "who shot me": the same firing-group-root resolution
    // the damage path uses (aggression_plugin's damagerRoot — group root,
    // else the concrete firer). Crediting the concrete firer here while
    // damage credited the root split one escort's missile into two
    // different aggressor entries on the victim (review finding M1,
    // 2026-08-15).
    const aggressor = shooter?.components.get(FiringGroupComponent)?.group
        ?? source ?? ownerRoot;
    const npc = victim.components.get(NpcComponent);
    if (npc) {
        npc.aggressor = aggressor;
        npc.nextDecision = 0;
    }
    // A lock draws no blood, but it is hostile on its face, so it flips
    // the pair hostile outright rather than feeding the damage
    // accumulator.
    applyAggression(victim, aggressor, now,
        { damage: 0, deliberate: true });
}
