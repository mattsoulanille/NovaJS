import { Emit, Entities } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { EcsKeyboardEvent, KeyboardPlugin } from 'nova_ecs/plugins/keyboard_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { NewOwnedEntityEvent } from 'nova_ecs/plugins/multiplayer_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { PlatformResource } from './platform_plugin';

export enum ControlAction {
    'accelerate',
    'turnLeft',
    'turnRight',
    'reverse',
    'firePrimary',
    'cycleTarget',
}

// TODO: Support loading this from the server.
// TODO: Support modifier keys changing behavior.
const keyMap = new Map([
    ['ArrowUp', ControlAction.accelerate],
    ['ArrowLeft', ControlAction.turnLeft],
    ['ArrowRight', ControlAction.turnRight],
    ['ArrowDown', ControlAction.reverse],
    ['Space', ControlAction.firePrimary],
    ['Tab', ControlAction.cycleTarget],
]);

// Used to mark the single ship that's under control.
export const PlayerShipSelector = new Component<undefined>('ShipControl');

type ControlState = Map<ControlAction, false | 'start' | 'repeat' | true>;

// A resource because the ship may change.
const ControlStateResource = new Resource<ControlState>('ControlStateResource');


const SetControlledShip = new System({
    name: 'SetControlledShip',
    events: [NewOwnedEntityEvent],
    args: [NewOwnedEntityEvent, Entities] as const,
    step: (newEntity, entities) => {
        if (entities.has(newEntity)) {
            // This rarely happens, but is looping over all the entities
            // too expensive? Probably not.
            // When queries are cached, use a query for just the multiplayer
            // entities as an optimization.
            for (const entity of entities.values()) {
                entity.components.delete(PlayerShipSelector);
            }
            const entity = entities.get(newEntity);
            entity?.components.set(PlayerShipSelector, undefined);

            // For convenience
            (window as any).myShip = entity;
        }
    }
});

export const ControlStateEvent = new EcsEvent<ControlState>('ControlState');

const UpdateControlState = new System({
    name: 'UpdateControlState',
    events: [EcsKeyboardEvent],
    args: [EcsKeyboardEvent, ControlStateResource, Emit, SingletonComponent] as const,
    step(event, controlState, emit) {
        const action = keyMap.get(event.code);
        if (action === undefined) {
            return;
        }

        // Avoid accidentally sending a 'start' or 'repeat' event that's
        // not actually happening.
        for (const [key, val] of controlState) {
            if (val) {
                controlState.set(key, true);
            }
        }

        const eventType = event.type === 'keyup' ? false
            : event.repeat ? 'repeat' : 'start';

        controlState.set(action, eventType);
        emit(ControlStateEvent, controlState);
    }
});


// TODO: Move this to ship plugin?
const ControlPlayerShip = new System({
    name: 'ControlPlayerShip',
    events: [ControlStateEvent],
    args: [ControlStateEvent, MovementStateComponent, PlayerShipSelector] as const,
    step(controlState, movementState) {
        movementState.accelerating = (
            controlState.get(ControlAction.accelerate) &&
            !controlState.get(ControlAction.reverse)) ? 1 : 0;

        movementState.turning =
            (controlState.get(ControlAction.turnLeft) ? -1 : 0) +
            (controlState.get(ControlAction.turnRight) ? 1 : 0);

        movementState.turnBack = Boolean(controlState.get(ControlAction.reverse));
    }
});

export const ShipController: Plugin = {
    name: 'ShipController',
    build(world) {
        const platform = world.resources.get(PlatformResource);
        if (platform === 'browser') {
            world.addPlugin(KeyboardPlugin);
            world.resources.set(ControlStateResource, new Map());
            world.addSystem(SetControlledShip);
            world.addSystem(UpdateControlState);
            world.addSystem(ControlPlayerShip);
        }
    }
};
