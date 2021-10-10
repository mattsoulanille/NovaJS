import * as t from 'io-ts';
import { ShipData } from "novadatainterface/ShipData";
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementPhysicsComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { Provide, ProvideAsync } from 'nova_ecs/provider';
import { AnimationComponent } from './animation_plugin';
import { CollisionInteractionComponent } from './collision_interaction';
import { GameDataResource } from './game_data_resource';
import { OutfitsStateComponent } from './outfit_plugin';

export const ShipType = t.type({
    id: t.string // Not a UUID. A nova id.
});
export type ShipType = t.TypeOf<typeof ShipType>;

export const ShipComponent = new Component<ShipType>('Ship');

export const ShipDataComponent = new Component<ShipData>('ShipData');

export const ShipDataProvider = ProvideAsync({
    name: "ShipDataProvider",
    provided: ShipDataComponent,
    args: [GameDataResource, ShipComponent] as const,
    update: [ShipComponent],
    factory: async (gameData, ship) => {
        console.log('providing shipData ' + ship.id);
        return await gameData.data.Ship.get(ship.id);
    }
});

export const ShipOutfitsProvider = Provide({
    name: "ShipOutfitsProvider",
    provided: OutfitsStateComponent,
    args: [ShipDataComponent] as const,
    update: [ShipDataComponent],
    factory(shipData) {
        return new Map(Object.entries(shipData.outfits)
            .map(([id, count]) => [id, { count }]));
    }
});

export const ShipMovementPhysicsProvider = ProvideAsync({
    name: "ShipMovementPhysicsProvider",
    provided: MovementPhysicsComponent,
    args: [ShipDataComponent] as const,
    update: [ShipDataComponent],
    async factory(shipData) {
        return {
            acceleration: shipData.physics.acceleration,
            maxVelocity: shipData.physics.speed,
            movementType: shipData.physics.inertialess
                ? MovementType.INERTIALESS : MovementType.INERTIAL,
            turnRate: shipData.physics.turnRate,
        }
    },
});

const ShipAnimationProvider = Provide({
    name: "ShipAnimationProvider",
    provided: AnimationComponent,
    update: [ShipDataComponent],
    args: [ShipDataComponent],
    factory: shipData => shipData.animation,
});

const ShipCollisionInteractionProvider = Provide({
    name: "ShipCollisionInteractionProvider",
    provided: CollisionInteractionComponent,
    args: [ShipComponent] as const,
    factory: () => ({
        vulnerableTo: new Set(['normal']),
    }),
});

export const ShipPlugin: Plugin = {
    name: "ShipPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        world.addComponent(ShipComponent);
        world.addComponent(ShipDataComponent);

        world.addSystem(ShipCollisionInteractionProvider);
        world.addSystem(ShipDataProvider);
        world.addSystem(ShipAnimationProvider);
        world.addSystem(ShipOutfitsProvider);
        world.addSystem(ShipMovementPhysicsProvider);

        deltaMaker.addComponent(ShipComponent, {
            componentType: ShipType
        });
    }
}
