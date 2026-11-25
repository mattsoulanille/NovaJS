import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Emit, EmitNow, Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { ProvideArg } from 'nova_ecs/provide_arg';
import { System } from 'nova_ecs/system';
import { BlastDamageComponent, BlastIgnoreComponent } from '../ship/index.js';
import { CollisionSystem } from '../core/index.js';
import { CollisionEvent } from '../core/index.js';
import { DamagedEvent } from '../ship/index.js';
import { OwnerComponent, SourceComponent } from '../ship/index.js';
import { disabledCancelsImmunity, FiringGroupComponent, firingImmune, victimFiringGroup } from '../ship/index.js';
import { GovtComponent } from '../core/index.js';
import { DisabledComponent } from '../ship/index.js';
import { ShipCargoProvider, ShipExplosionComponent } from '../ship/index.js';
import { insideShipExplosion, shipExplosionReach } from '../ship/index.js';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';


export { BlastDamageComponent, BlastIgnoreComponent } from '../ship/index.js';

export const BlastCollisionSystem = new System({
    name: 'BlastCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, BlastDamageComponent, Entities,
        Optional(BlastIgnoreComponent), Optional(FiringGroupComponent),
        EmitNow, UUID, Optional(ShipExplosionComponent),
        Optional(SourceComponent), Optional(MovementStateComponent)] as const,
    step(collision, damage, entities, ignore, firingGroup, emitNow, uuid,
        shipExplosion, source, movement) {
        if (ignore?.has(collision.other)) {
            return;
        }
        const other = entities.get(collision.other);
        // A ship's final explosion hits what its square holds by the
        // victim's CENTRE (ship_explosion.ts's shipExplosionReach,
        // reference "Ship explosion blast, wave 28"); the square hurtbox
        // found every hull it merely overlaps.
        if (shipExplosion && movement) {
            const at = other?.components.get(MovementStateComponent)
                ?.position;
            if (!at || !insideShipExplosion(at.x - movement.position.x,
                at.y - movement.position.y,
                shipExplosionReach(shipExplosion.mass))) {
                return;
            }
        }
        // Friendly-fire immunity: a blast whose weapon spares its firer
        // (blastHurtsFiringShip unset) carries the firer's group and
        // spares the whole group (see firing_group.ts).
        // BLAST_FLOCK_RULE 'flockAlwaysSpared' (firing_group.ts): a blast
        // that hurts its firing ship spares the rest of the group only.
        const firerHit = firingGroup?.hurtsFirer === true
            && source !== undefined && collision.other === source;
        if (other && !firerHit && firingImmune(
            firingGroup?.group,
            victimFiringGroup(other.components.get(FiringGroupComponent),
                other.components.get(OwnerComponent)?.owner,
                collision.other),
            firingGroup?.govt,
            other.components.get(GovtComponent)?.id,
            // Same rule as the projectile and beam paths: a DISABLED
            // victim forfeits group immunity, except the shot's own
            // firer (a ship that dies by firing — wëap AmmoType -999 —
            // is disabled the same tick its shot is still in the air).
            // The blast carries the projectile's SourceComponent for
            // exactly this test (review r13 LOW).
            disabledCancelsImmunity(collision.other,
                other.components.has(DisabledComponent), source),
            // A blast DOES splash ships of its firer's government
            // (measured: SAME_GOVT_FIRING_IMMUNITY).
            'blast')) {
            return;
        }
        // A ship's own final explosion can hurt but never disable or
        // destroy a ship (ship_explosion_plugin.ts).
        emitNow(DamagedEvent, {
            damage, damager: uuid,
            nonLethal: Boolean(shipExplosion),
        }, [collision.other])
    }
});

export const BlastDoneComponent = new Component<{ done: boolean }>('BlastDone');
const BlastDoneProvider = ProvideArg({
    provided: BlastDoneComponent,
    args: [] as const,
    factory: () => ({ done: false }),
});
// Deletes blasts after they've existed for one frame
export const BlastEndSystem = new System({
    name: 'BlastEndSystem',
    // Happens before the collision system so blasts can
    // exist for exactly one collision event (todo: maybe collision
    // event should emit the entity value directly?). ShipCargoProvider
    // is a #237 pin (shared: *): BlastPlugin registers before CargoPlugin.
    before: [CollisionSystem, ShipCargoProvider],
    args: [Entities, UUID, BlastDoneProvider, BlastDamageComponent] as const,
    step(entities, uuid, blastDone) {
        if (blastDone.done) {
            entities.delete(uuid);
        }
        blastDone.done = true;
    },
});

export const BlastPlugin: Plugin = {
    name: 'BlastPlugin',
    build(world) {
        world.addSystem(BlastCollisionSystem);
        world.addSystem(BlastEndSystem);
    }
}
