import { Emit } from 'nova_ecs/arg_types';
import { Plugin } from 'nova_ecs/plugin';
import { KeyboardPlugin } from 'nova_ecs/plugins/keyboard_plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementSystem, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { EcsControlEvent } from './controls_plugin';
import { ControlState, ControlStateEvent } from './control_state_event';
import { PlatformResource } from './platform_plugin';
import { PlayerShipPlugin, PlayerShipSelector } from './player_ship_plugin';
import { TargetComponent } from './target_component';


// A resource because the ship may change.
const ControlStateResource = new Resource<ControlState>('ControlStateResource');

const UpdateControlState = new System({
    name: 'UpdateControlState',
    events: [EcsControlEvent],
    args: [EcsControlEvent, ControlStateResource,
        Emit, SingletonComponent] as const,
    step(event, controlState, emit) {
        // Avoid accidentally sending a 'start' or 'repeat' event that's
        // not actually happening.
        for (const [key, val] of controlState) {
            if (val) {
                controlState.set(key, true);
            }
        }

        controlState.set(event.action, event.state);
        emit(ControlStateEvent, controlState);
    }
});


// TODO: Move this to ship plugin?
const ControlPlayerShip = new System({
    name: 'ControlPlayerShip',
    args: [ControlStateResource, MovementStateComponent,
        MovementPhysicsComponent, TargetComponent, PlayerShipSelector] as const,
    step(controlState, movementState, movementPhysics, { target }) {
        movementState.accelerating = controlState.get('accelerate') ? 1 : 0;
        movementState.turning =
            (controlState.get('turnLeft') ? -1 : 0) +
            (controlState.get('turnRight') ? 1 : 0);

        movementState.turnTo = null;
        if (controlState.get('pointTo') && target) {
            movementState.turnTo = target;
        }

        if (movementPhysics.movementType === MovementType.INERTIAL) {
            movementState.turnBack = Boolean(controlState.get('reverse'));
        } else if (movementPhysics.movementType === MovementType.INERTIALESS) {
            movementState.turnBack = false;
            if (controlState.get('reverse')) {
                movementState.accelerating += -1;
            }
        }
    },
    before: [MovementSystem]
});

export const ShipController: Plugin = {
    name: 'ShipController',
    async build(world) {
        const platform = world.resources.get(PlatformResource);
        if (platform === 'browser') {
            await world.addPlugin(KeyboardPlugin);
            await world.addPlugin(PlayerShipPlugin);
            world.resources.set(ControlStateResource, new Map());
            world.addSystem(ControlPlayerShip);
            world.addSystem(UpdateControlState);
        }
    }
};
