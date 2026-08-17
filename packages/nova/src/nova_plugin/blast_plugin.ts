import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Emit, EmitNow, Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { ProvideArg } from 'nova_ecs/provide_arg';
import { System } from 'nova_ecs/system';
import { BlastDamageComponent, BlastIgnoreComponent } from './blast_data.js';
import { CollisionSystem } from './collisions_plugin.js';
import { CollisionEvent } from './collision_interaction.js';
import { DamagedEvent } from './death_plugin.js';
import { OwnerComponent } from './weapon_components.js';
import { FiringGroupComponent, firingImmune, victimFiringGroup } from './firing_group.js';
import { GovtComponent } from './govt_component.js';
import { DisabledComponent } from './disabled_component.js';
import { ShipExplosionComponent } from './ship_explosion.js';


export { BlastDamageComponent, BlastIgnoreComponent } from './blast_data.js';

export const BlastCollisionSystem = new System({
    name: 'BlastCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, BlastDamageComponent, Entities,
        Optional(BlastIgnoreComponent), Optional(FiringGroupComponent),
        EmitNow, UUID, Optional(ShipExplosionComponent)] as const,
    step(collision, damage, entities, ignore, firingGroup, emitNow, uuid,
        shipExplosion) {
        if (ignore?.has(collision.other)) {
            return;
        }
        // Friendly-fire immunity: a blast whose weapon spares its firer
        // (blastHurtsFiringShip unset) carries the firer's group and
        // spares the whole group (see firing_group.ts).
        const other = entities.get(collision.other);
        if (other && firingImmune(
            firingGroup?.group,
            victimFiringGroup(other.components.get(FiringGroupComponent),
                other.components.get(OwnerComponent)?.owner,
                collision.other),
            firingGroup?.govt,
            other.components.get(GovtComponent)?.id,
            other.components.has(DisabledComponent))) {
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
const BlastEndSystem = new System({
    name: 'BlastEndSystem',
    // Happens before the collision system so blasts can
    // exist for exactly one collision event (todo: maybe collision
    // event should emit the entity value directly?)
    before: [CollisionSystem],
    args: [Entities, UUID, BlastDoneProvider, BlastDamageComponent] as const,
    step(entities, uuid, blastDone) {
        if (blastDone.done) {
            entities.delete(uuid);
        }
        blastDone.done = true;
    }
});

export const BlastPlugin: Plugin = {
    name: 'BlastPlugin',
    build(world) {
        world.addSystem(BlastCollisionSystem);
        world.addSystem(BlastEndSystem);
    }
}
