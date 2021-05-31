import { isLeft } from 'fp-ts/lib/Either';
import { Emit } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { EcsKeyboardEvent, KeyboardPlugin } from 'nova_ecs/plugins/keyboard_plugin';
import { MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { GameData } from '../client/gamedata/GameData';
import { Controls, SavedControls, getAction, ControlAction } from './controls';
import { GameDataResource } from './game_data_resource';
import { PlatformResource } from './platform_plugin';
import { PlayerShipPlugin, PlayerShipSelector } from './player_ship_plugin';
import { TargetComponent } from './target_component';


const ControlsResource = new Resource<Controls>('ControlsResource');

type ControlState = Map<ControlAction, false | 'start' | 'repeat' | true>;

// A resource because the ship may change.
const ControlStateResource = new Resource<ControlState>('ControlStateResource');

export const ControlStateEvent = new EcsEvent<ControlState>('ControlState');

const UpdateControlState = new System({
    name: 'UpdateControlState',
    events: [EcsKeyboardEvent],
    args: [EcsKeyboardEvent, ControlStateResource, ControlsResource,
        Emit, SingletonComponent] as const,
    step(event, controlState, controls, emit) {
        const action = getAction(controls, event);
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
    args: [ControlStateResource, MovementStateComponent,
        TargetComponent, PlayerShipSelector] as const,
    step(controlState, movementState, { target }) {
        movementState.accelerating = (
            controlState.get('accelerate') &&
            !controlState.get('reverse')) ? 1 : 0;

        movementState.turning =
            (controlState.get('turnLeft') ? -1 : 0) +
            (controlState.get('turnRight') ? 1 : 0);

        movementState.turnTo = null;
        if (controlState.get('pointTo') && target) {
            movementState.turnTo = target;
        }

        movementState.turnBack = Boolean(controlState.get('reverse'));
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

            const gameData = world.resources.get(GameDataResource) as GameData;
            if (!gameData) {
                throw new Error('Expected world to have gameData');
            }
            const controlsJson = await gameData.getSettings('controls.json');
            const decoded = SavedControls.pipe(Controls).decode(controlsJson);
            if (isLeft(decoded)) {
                console.error(decoded.left);
                throw new Error('Failed to parse controls');
            }
            world.resources.set(ControlsResource, decoded.right);
            world.addSystem(UpdateControlState);
        }
    }
};
