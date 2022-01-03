import { Emit, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EcsEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementPhysicsComponent } from "nova_ecs/plugins/movement_plugin";
import { System } from "nova_ecs/system";
import { IonizationComponent } from "./health_plugin";
import { getShipMovementPhysics, ShipPhysicsComponent } from "./ship_plugin";


const ION_FACTOR = 0.6

export const IonizedEvent = new EcsEvent<boolean>('IonizedEvent');
export const IsIonizedComponent = new Component<boolean>('IsIonizedComponent');

const IonizedSystem = new System({
    name: 'IonizedSystem',
    args: [IonizationComponent, Optional(IsIonizedComponent), GetEntity, UUID, Emit] as const,
    step(ionization, wasIonized, entity, uuid, emit) {
        const isIonized = ionization.current > ionization.max / 2;
        if (isIonized === wasIonized) {
            return;
        }

        entity.components.set(IsIonizedComponent, isIonized);
        emit(IonizedEvent, isIonized, [uuid]);
    }
});

const IonizationSlownessSystem = new System({
    name: 'IonizationSLownessSystem',
    events: [IonizedEvent],
    args: [IonizedEvent, ShipPhysicsComponent, GetEntity] as const,
    step(ionized, shipPhysics, entity) {
        const movement = getShipMovementPhysics(shipPhysics);
        if (ionized) {
            movement.maxVelocity *= ION_FACTOR;
            movement.acceleration *= ION_FACTOR;
            movement.turnRate *= ION_FACTOR;
        }
        entity.components.set(MovementPhysicsComponent, movement);
    }
});

export const IonizedPlugin: Plugin = {
    name: 'IonizedPlugin',
    build(world) {
        world.addSystem(IonizedSystem)
            .addSystem(IonizationSlownessSystem);
    },
    remove(world) {
        world.removeSystem(IonizedSystem)
            .removeSystem(IonizationSlownessSystem);
    },
}
