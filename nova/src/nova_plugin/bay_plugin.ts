import { BayWeaponData, WeaponData } from 'novadatainterface/WeaponData';
import { Entities, GetEntity, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { v4 } from 'uuid';
import { HitboxHullComponent, HurtboxHullComponent } from './collisions_plugin';
import { CollisionEvent, CollisionHitterComponent, CollisionVulnerabilityComponent } from './collision_interaction';
import { ExitPointData } from './exit_point';
import { OwnerComponent, SourceComponent, WeaponConstructors, WeaponEntry } from './fire_weapon_plugin';
import { DeathAIComponent, FollowComponent, ShootAllWeaponsComponent } from './npc_plugin';
import { ShipComponent } from './ship_plugin';
import { TargetComponent } from './target_component';
import { TargetRemovedEvent } from './target_plugin';
import { WeaponsStateComponent } from './weapons_state';

const CollectableEscortComponent = new Component<undefined>('CollectableEscort');
const ReturnComponent = new Component<undefined>('ReturnComponent');
const ReturnWhenTargetRemovedComponent = new Component<undefined>('ReturnWhenTargetRemoved');

class BayWeaponEntry extends WeaponEntry {
    declare data: BayWeaponData;
    protected pointDefenseRangeSquared;
    //    private factoryQueue: FactoryQueue<Entity>;

    constructor(data: WeaponData, runQuery: RunQueryFunction) {
        if (data.type !== 'BayWeaponData') {
            throw new Error('Data type must be BayWeaponData');
        }

        super(data, runQuery);

        this.pointDefenseRangeSquared = 0;

        // const queueHolder = {} as { queue: FactoryQueue<Entity> };
        // this.factoryQueue = new FactoryQueue(() => {
        //     const ship = new Entity();
        //     ship.components.set(ShipComponent, {
        //         id: data.shipID,
        //     }).set(MovementStateComponent, {
        //         accelerating: 0,
        //         position: new Position(0, 0),
        //         rotation: new Angle(0),
        //         turnBack: false,
        //         turning: 0,
        //         velocity: new Vector(0, 0),
        //     }).set(ReturnToQueueComponent, queueHolder)
        //         .set(DeathAIComponent, undefined);
        //     return ship;
        // });
        // queueHolder.queue = this.factoryQueue;
    }

    private makeShip() {
        const ship = new Entity();
        ship.components.set(ShipComponent, {
            id: this.data.shipID,
        }).set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(0, 0),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        }).set(DeathAIComponent, undefined)
            .set(ShootAllWeaponsComponent, undefined)
            .set(FollowComponent, undefined)
            .set(ReturnWhenTargetRemovedComponent, undefined)
        return ship;
    }

    fire(position: Position, angle: Angle, owner: string, target = undefined, source: string, sourceVelocity?: Vector, exitPointData?: ExitPointData): Entity | undefined {
        let velocity = new Vector(0, 0);
        if (sourceVelocity) {
            velocity.add(sourceVelocity);
        }
        // TODO: Add exit velocity to bay weapons.
        velocity.add(angle.getUnitVector().scale(10));

        const ship = this.makeShip();
        ship.components.set(OwnerComponent, owner);
        ship.components.set(SourceComponent, source);
        ship.components.set(TargetComponent, { target });
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: Position.fromVectorLike(position),
            velocity: Vector.fromVectorLike(velocity),
            rotation: Angle.fromAngleLike(angle),
            turnBack: false,
            turning: 0,
        });
        ship.components.set(TargetComponent, { target: target });
        if (target === undefined) {
            return undefined;
        }

        this.entities.set(v4(), ship);
        const ownerVuln = this.entities.get(source)?.components
            .get(CollisionVulnerabilityComponent);
        ownerVuln?.vulnerableTo.add(`return_escorts`);

        return ship;
    }
}

const CollectableEscortAI = new System({
    name: 'CollectableEscortAI',
    events: [CollisionEvent],
    args: [CollisionEvent, SourceComponent, Entities, UUID, CollectableEscortComponent] as const,
    step(collision, source, entities, uuid) {
        if (collision.other === source) {
            entities.delete(uuid);
        }
    },
});

const ReturnWhenTargetRemovedAI = new System({
    name: 'ReturnWhenTargetRemovedAI',
    events: [TargetRemovedEvent],
    args: [GetEntity, WeaponsStateComponent,
        ReturnWhenTargetRemovedComponent] as const,
    step(entity, weapons) {
        entity.components.delete(ShootAllWeaponsComponent);
        entity.components.delete(FollowComponent);
        for (const [, weapon] of weapons) {
            weapon.firing = false;
        }
        entity.components.set(ReturnComponent, undefined);
        entity.components.set(CollectableEscortComponent, undefined);
        entity.components.set(CollisionHitterComponent, {
            hitTypes: new Set([`return_escorts`]),
        });
        const hitbox = entity.components.get(HitboxHullComponent);
        if (hitbox) {
            entity.components.set(HurtboxHullComponent, hitbox);
        }
    }
});

const ReturnAI = new System({
    name: 'ReturnToBase',
    args: [OwnerComponent, MovementStateComponent, ReturnComponent] as const,
    step(owner, movementState) {
        movementState.turnTo = owner;
        movementState.accelerating = 1;
    }
});

export const BayPlugin: Plugin = {
    name: 'BayPlugin',
    build(world) {
        const weaponConstructors = world.resources.get(WeaponConstructors);
        if (!weaponConstructors) {
            throw new Error('Expected WeaponConstructors to exist');
        }
        weaponConstructors.set('BayWeaponData', BayWeaponEntry);
        world.addSystem(ReturnAI);
        world.addSystem(ReturnWhenTargetRemovedAI);
        world.addSystem(CollectableEscortAI);
    }
}
