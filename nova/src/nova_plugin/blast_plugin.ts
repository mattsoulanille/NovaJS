import { WeaponDamage } from 'novadatainterface/WeaponData';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { ProvideArg } from 'nova_ecs/provide_arg';
import { System } from 'nova_ecs/system';
import { CollisionSystem } from './collisions_plugin';
import { CollisionEvent } from './collision_interaction';
import { ApplyDamageResource } from './death_plugin';


// Damage done by a blast.
export const BlastDamageComponent = new Component<WeaponDamage>('BlastComponent');

// A set of entities not to interact with. Usually just the entity that
// the projectile already hit so damage is not applied twice.
export const BlastIgnoreComponent = new Component<Set<string>>('BlastIgnoreComponent');

const BlastCollisionSystem = new System({
    name: 'BlastCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, BlastDamageComponent,
        Optional(BlastIgnoreComponent), ApplyDamageResource] as const,
    step(collision, damage, ignore, applyDamage) {
        if (ignore?.has(collision.other)) {
            return;
        }
        applyDamage(damage, collision.other, 1);
    }
});

const BlastDoneComponent = new Component<{ done: boolean }>('BlastDone');
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